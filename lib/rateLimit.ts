// Distributed rate limiter using Upstash Redis.
// Falls back to allowing the request if Redis is unavailable (e.g. local dev without Redis configured).

import { Redis } from "@upstash/redis";

let redis: Redis | null = null;

function getRedis(): Redis | null {
  if (redis) return redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  redis = new Redis({ url, token });
  return redis;
}

export type RedisHealth =
  | { state: "ok"; latencyMs: number }
  | { state: "not_configured" }
  | { state: "unreachable"; latencyMs: number };

/**
 * Liveness probe for the Redis dependency, for /api/health.
 *
 * Distinguishes "not configured" (dev, and any deploy without Upstash env set)
 * from "configured but unreachable" (a real outage). Callers decide the HTTP
 * consequence — this only reports.
 */
// A dead Upstash host takes ~4.3s to surface a connection error, which would
// stall every /api/health call for that long. Bound it: past this, the answer
// is "unreachable" regardless of what the socket eventually says.
const HEALTH_PING_TIMEOUT_MS = 2_000;

export async function redisHealth(): Promise<RedisHealth> {
  const store = getRedis();
  if (!store) return { state: "not_configured" };
  const started = Date.now();
  try {
    await Promise.race([
      store.ping(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("health ping timeout")), HEALTH_PING_TIMEOUT_MS).unref(),
      ),
    ]);
    return { state: "ok", latencyMs: Date.now() - started };
  } catch {
    return { state: "unreachable", latencyMs: Date.now() - started };
  }
}

/**
 * Returns true if the request is allowed, false if rate limited.
 * @param key      Unique key (e.g. "login:1.2.3.4")
 * @param limit    Max requests allowed in the window
 * @param windowMs Window size in milliseconds
 */
export async function rateLimit(key: string, limit: number, windowMs: number): Promise<boolean> {
  try {
    const store = getRedis();
    if (!store) return true;
    const windowSec = Math.ceil(windowMs / 1000);
    const count = await store.incr(key);
    if (count === 1) await store.expire(key, windowSec);
    return count <= limit;
  } catch (e) {
    // Allow on any Redis error rather than block legitimate users, but surface it
    console.error("[rateLimit] Redis error — failing open for key", key, e);
    if (process.env.NODE_ENV === "production") {
      try {
        const Sentry = await import("@sentry/nextjs");
        Sentry.captureException(e, {
          level: "warning",
          tags: { source: "rateLimit" },
          extra: { key },
        });
      } catch {
        // Don't let Sentry import failure break the rate limiter
      }
    }
    return process.env.NODE_ENV !== "production";
  }
}

// Number of proxies in front of this app that append to X-Forwarded-For.
// On Vercel this must stay 0: Vercel's edge *overwrites* X-Forwarded-For with
// the true client IP and does not forward client-supplied values, so the
// leftmost entry is trustworthy. Set this only if you put another proxy
// (Cloudflare, an ALB, an nginx ingress) in front, or enable Vercel's
// Enterprise "trusted proxy" mode — in both cases the client controls the
// leftmost entries and only the Nth-from-the-right hop is attacker-proof.
const TRUSTED_PROXY_HOPS = Number(process.env.TRUSTED_PROXY_HOPS ?? "0");

const IPV4 = /^(\d{1,3}\.){3}\d{1,3}$/;

/** Syntactic IP validation — rejects header junk before it becomes a bucket key. */
function isValidIp(v: string): boolean {
  if (!v || v.length > 45) return false;
  if (IPV4.test(v)) return v.split(".").every((o) => Number(o) <= 255);
  return v.includes(":") && /^[0-9a-fA-F:.]+$/.test(v); // IPv6, incl. v4-mapped
}

/**
 * Rate-limit against a source IP, with an explicit policy for un-attributable
 * requests. In production a request we cannot tie to a verified IP is denied
 * (fail closed) — on Vercel X-Forwarded-For is always present, so this only
 * trips on genuinely malformed traffic. Outside production nothing sets the
 * header, so it degrades to allow rather than blocking all local development.
 *
 * Prefer this over interpolating clientIp() into a key yourself: `${null}`
 * stringifies to "null" and silently rebuilds the shared-bucket bug.
 */
export async function rateLimitByIp(
  ip: string | null,
  prefix: string,
  limit: number,
  windowMs: number,
): Promise<boolean> {
  if (ip === null) return process.env.NODE_ENV !== "production";
  return rateLimit(`${prefix}:${ip}`, limit, windowMs);
}

/**
 * Extract the client IP for rate-limit bucketing.
 *
 * Returns null when no trustworthy IP can be established. Callers must decide
 * the policy for that case explicitly — it deliberately does not collapse to a
 * shared "unknown" bucket, which let every un-attributable request share one
 * counter and gave an attacker a way to exhaust it for everyone.
 */
export function clientIp(req: Request): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const hops = xff.split(",").map((h) => h.trim()).filter(Boolean);
    // Count from the right: those entries were appended by infrastructure we
    // control and cannot be forged by the client. Anything left of that is
    // client-supplied and is discarded.
    const idx = TRUSTED_PROXY_HOPS > 0 ? hops.length - 1 - TRUSTED_PROXY_HOPS : 0;
    const candidate = hops[idx];
    if (candidate && isValidIp(candidate)) return candidate;
  }
  const realIp = req.headers.get("x-real-ip")?.trim();
  if (realIp && isValidIp(realIp)) return realIp;
  return null;
}
