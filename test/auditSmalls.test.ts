import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const DB = !!process.env.DATABASE_URL;
const REDIS = !!process.env.UPSTASH_REDIS_REST_URL && !!process.env.UPSTASH_REDIS_REST_TOKEN;
process.env.JWT_SECRET ??= "smalls-test-secret";
process.env.JWT_REFRESH_SECRET ??= "smalls-test-refresh-secret";
process.env.CRON_SECRET ??= "smalls-test-cron-secret";

async function loadCtx() {
  const { prisma } = await import("../lib/prisma");
  const { signAccessToken, signRefreshToken } = await import("../lib/auth");
  const { NextRequest } = await import("next/server");
  return { prisma, signAccessToken, signRefreshToken, NextRequest };
}
type Ctx = Awaited<ReturnType<typeof loadCtx>>;

async function seedDepotUser(ctx: Ctx, tag: string, name: string, depotId: string, verified = false) {
  return ctx.prisma.user.create({
    data: { email: `${tag}-${name}@test.invalid`, passwordHash: "x", firstName: name, lastName: "T", depotId, verified },
    select: { id: true, email: true },
  });
}

async function cleanupTag(ctx: Ctx, tag: string, depotId: string) {
  const users = await ctx.prisma.user.findMany({ where: { email: { startsWith: tag } }, select: { id: true } });
  const ids = users.map(u => u.id);
  await ctx.prisma.notification.deleteMany({ where: { userId: { in: ids } } });
  await ctx.prisma.message.deleteMany({ where: { OR: [{ fromUserId: { in: ids } }, { toUserId: { in: ids } }] } });
  await ctx.prisma.block.deleteMany({ where: { OR: [{ blockerId: { in: ids } }, { blockedId: { in: ids } }] } });
  await ctx.prisma.swapAgreement.deleteMany({ where: { swap: { userId: { in: ids } } } });
  await ctx.prisma.swap.deleteMany({ where: { userId: { in: ids } } });
  await ctx.prisma.user.deleteMany({ where: { id: { in: ids } } });
  await ctx.prisma.depot.deleteMany({ where: { id: depotId } });
}

// ── (b) A10: deterministic pagination ───────────────────────────────────────

test("A10: identical createdAt rows paginate without skips or repeats", { skip: !DB }, async () => {
  const ctx = await loadCtx();
  const tag = `as-${randomUUID().slice(0, 8)}`;
  const depot = await ctx.prisma.depot.create({ data: { name: tag, code: tag, borough: "Queens", operator: "NYCT" } });
  try {
    const viewer = await seedDepotUser(ctx, tag, "viewer", depot.id);
    const poster = await seedDepotUser(ctx, tag, "poster", depot.id);
    const swapIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const s = await ctx.prisma.swap.create({
        data: { userId: poster.id, depotId: depot.id, category: "work", details: `${tag} swap ${i}`, posterName: "P T", status: "open" },
      });
      swapIds.push(s.id);
    }
    // Force IDENTICAL createdAt on all three — the nondeterminism trigger.
    await ctx.prisma.$executeRaw`UPDATE "swaps" SET "created_at" = '2026-07-01T12:00:00Z' WHERE "id" = ANY(${swapIds})`;

    const { GET } = await import("../app/api/swaps/route");
    const fetchPage = async (cursor?: string) => {
      const url = new URL("http://localhost/api/swaps?limit=2" + (cursor ? `&cursor=${cursor}` : ""));
      const res = await GET(new ctx.NextRequest(url, {
        headers: { authorization: `Bearer ${ctx.signAccessToken({ userId: viewer.id, email: viewer.email })}` },
      }));
      assert.equal(res.status, 200);
      return (await res.json()) as { swaps: { id: string }[]; nextCursor: string | null };
    };

    const page1 = await fetchPage();
    assert.equal(page1.swaps.length, 2);
    const page2 = await fetchPage(page1.nextCursor!);
    const seen = [...page1.swaps, ...page2.swaps].map(s => s.id);
    const uniq = new Set(seen);
    assert.equal(uniq.size, seen.length, "no repeats across pages");
    for (const id of swapIds) assert.ok(uniq.has(id), "no skipped rows");
  } finally { await cleanupTag(ctx, tag, depot.id); }
});

// ── (c) A13: expiry correctness ─────────────────────────────────────────────

test("A13: daysoff expires on the LATER date; vacation expires at createdAt+60d", { skip: !DB }, async () => {
  const ctx = await loadCtx();
  const tag = `as-${randomUUID().slice(0, 8)}`;
  const depot = await ctx.prisma.depot.create({ data: { name: tag, code: tag, borough: "Queens", operator: "NYCT" } });
  try {
    const owner = await seedDepotUser(ctx, tag, "owner", depot.id);
    const past = new Date("2026-06-01T00:00:00Z");
    const past2 = new Date("2026-06-10T00:00:00Z");
    const future = new Date(Date.now() + 20 * 86400_000);

    const mkDaysoff = (fromDate: Date, toDate: Date | null, n: string) =>
      ctx.prisma.swap.create({
        data: { userId: owner.id, depotId: depot.id, category: "daysoff", details: `${tag} ${n}`, posterName: "O T", status: "open", fromDate, toDate },
      });
    const stillLive = await mkDaysoff(past, future, "from-past to-future");   // must SURVIVE
    const bothPast = await mkDaysoff(past, past2, "both past");               // must EXPIRE
    const noToDate = await mkDaysoff(past, null, "from past, no toDate");     // must EXPIRE

    const vacOld = await ctx.prisma.swap.create({
      data: { userId: owner.id, depotId: depot.id, category: "vacation", details: `${tag} vac old`, posterName: "O T", status: "open" },
    });
    const vacFresh = await ctx.prisma.swap.create({
      data: { userId: owner.id, depotId: depot.id, category: "vacation", details: `${tag} vac fresh`, posterName: "O T", status: "open" },
    });
    await ctx.prisma.$executeRaw`UPDATE "swaps" SET "created_at" = NOW() - INTERVAL '61 days' WHERE "id" = ${vacOld.id}`;
    await ctx.prisma.$executeRaw`UPDATE "swaps" SET "created_at" = NOW() - INTERVAL '30 days' WHERE "id" = ${vacFresh.id}`;

    const { GET } = await import("../app/api/cron/expire-swaps/route");
    const res = await GET(new ctx.NextRequest("http://localhost/api/cron/expire-swaps", {
      headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
    }));
    assert.equal(res.status, 200);

    const status = async (id: string) => (await ctx.prisma.swap.findUniqueOrThrow({ where: { id } })).status;
    assert.equal(await status(stillLive.id), "open", "daysoff with future toDate survives");
    assert.equal(await status(bothPast.id), "expired", "daysoff with both dates past expires");
    assert.equal(await status(noToDate.id), "expired", "daysoff with only a past fromDate expires");
    assert.equal(await status(vacOld.id), "expired", "vacation older than 60d expires");
    assert.equal(await status(vacFresh.id), "open", "vacation younger than 60d survives");
  } finally { await cleanupTag(ctx, tag, depot.id); }
});

// ── (d) A12: refresh rotation ───────────────────────────────────────────────

function cookieFromResponse(res: Response, name: string): string | null {
  // NextResponse exposes a typed cookie jar; fall back to raw headers.
  const jar = (res as unknown as { cookies?: { get: (n: string) => { value: string } | undefined } }).cookies;
  const fromJar = jar?.get(name)?.value;
  if (fromJar) return fromJar;
  const all = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  for (const c of all) {
    if (c.startsWith(`${name}=`)) return c.split(";")[0].slice(name.length + 1);
  }
  return null;
}

test("A12 (Redis-less fallback): rotation returns fresh cookies; reuse is not rejected without Redis", { skip: !DB || REDIS }, async () => {
  const ctx = await loadCtx();
  const tag = `as-${randomUUID().slice(0, 8)}`;
  const depot = await ctx.prisma.depot.create({ data: { name: tag, code: tag, borough: "Queens", operator: "NYCT" } });
  try {
    const user = await seedDepotUser(ctx, tag, "auth", depot.id, true);
    const refreshToken = ctx.signRefreshToken({ userId: user.id, email: user.email });
    // JWT iat is second-granular — space the rotation so the replacement
    // token can't be byte-identical to the seed.
    await new Promise((r) => setTimeout(r, 1100));

    const { POST } = await import("../app/api/auth/refresh/route");
    const call = (token: string) => POST(new ctx.NextRequest("http://localhost/api/auth/refresh", {
      method: "POST",
      headers: { cookie: `refreshToken=${token}` },
    }));

    const r1 = await call(refreshToken);
    assert.equal(r1.status, 200);
    const newRefresh = cookieFromResponse(r1, "refreshToken");
    assert.ok(newRefresh && newRefresh !== refreshToken, "rotation issued a fresh refresh token");

    // Documented Redis-less semantics: revocation isn't enforced, so reuse
    // still succeeds (and thus the multi-tab race can't 401 either).
    const r2 = await call(refreshToken);
    assert.equal(r2.status, 200);
  } finally { await cleanupTag(ctx, tag, depot.id); }
});

test("A12 (grace window, Redis required): reuse inside 30s returns the SAME pair", { skip: !DB || !REDIS }, async () => {
  const ctx = await loadCtx();
  const tag = `as-${randomUUID().slice(0, 8)}`;
  const depot = await ctx.prisma.depot.create({ data: { name: tag, code: tag, borough: "Queens", operator: "NYCT" } });
  try {
    const user = await seedDepotUser(ctx, tag, "auth", depot.id, true);
    const refreshToken = ctx.signRefreshToken({ userId: user.id, email: user.email });
    // JWT iat is second-granular — space the rotation so the replacement
    // token can't be byte-identical to the seed.
    await new Promise((r) => setTimeout(r, 1100));

    const { POST } = await import("../app/api/auth/refresh/route");
    const call = (token: string) => POST(new ctx.NextRequest("http://localhost/api/auth/refresh", {
      method: "POST",
      headers: { cookie: `refreshToken=${token}` },
    }));

    const r1 = await call(refreshToken);
    assert.equal(r1.status, 200);
    const pair1 = cookieFromResponse(r1, "refreshToken");

    // Loser of the multi-tab race: same OLD token, inside the window → 200
    // with the SAME replacement pair, not 401 and not a second rotation.
    const r2 = await call(refreshToken);
    assert.equal(r2.status, 200);
    const pair2 = cookieFromResponse(r2, "refreshToken");
    assert.equal(pair2, pair1, "grace reuse returns the identical replacement token");

    // The replacement token itself still rotates normally.
    const r3 = await call(pair1!);
    assert.equal(r3.status, 200);
  } finally { await cleanupTag(ctx, tag, depot.id); }
});

// ── (e) logout-all revocation ──────────────────────────────────────────────

test("logout-all rejects a previously issued refresh token", { skip: !DB || !REDIS }, async () => {
  const ctx = await loadCtx();
  const tag = `as-${randomUUID().slice(0, 8)}`;
  const depot = await ctx.prisma.depot.create({ data: { name: tag, code: tag, borough: "Queens", operator: "NYCT" } });
  try {
    const user = await seedDepotUser(ctx, tag, "logout", depot.id, true);
    const accessToken = ctx.signAccessToken({ userId: user.id, email: user.email });
    const refreshToken = ctx.signRefreshToken({ userId: user.id, email: user.email });

    const { POST: logoutAll } = await import("../app/api/auth/logout-all/route");
    const logoutResponse = await logoutAll(new ctx.NextRequest("http://localhost/api/auth/logout-all", {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}` },
    }));
    assert.equal(logoutResponse.status, 200);

    const { POST: refresh } = await import("../app/api/auth/refresh/route");
    const refreshResponse = await refresh(new ctx.NextRequest("http://localhost/api/auth/refresh", {
      method: "POST",
      headers: { cookie: `refreshToken=${refreshToken}` },
    }));
    assert.equal(refreshResponse.status, 401);
  } finally { await cleanupTag(ctx, tag, depot.id); }
});

// ── (f) blocked conversation reads ─────────────────────────────────────────

test("blocked users cannot read or mark a conversation as read", { skip: !DB }, async () => {
  const ctx = await loadCtx();
  const tag = `as-${randomUUID().slice(0, 8)}`;
  const depot = await ctx.prisma.depot.create({ data: { name: tag, code: tag, borough: "Queens", operator: "NYCT" } });
  try {
    const viewer = await seedDepotUser(ctx, tag, "viewer", depot.id, true);
    const counterpart = await seedDepotUser(ctx, tag, "counterpart", depot.id, true);
    const message = await ctx.prisma.message.create({
      data: { fromUserId: counterpart.id, toUserId: viewer.id, text: `${tag} message` },
    });
    await ctx.prisma.block.create({ data: { blockerId: viewer.id, blockedId: counterpart.id } });

    const { GET: getThread } = await import("../app/api/messages/thread/route");
    const threadResponse = await getThread(new ctx.NextRequest(`http://localhost/api/messages/thread?with=${counterpart.id}`, {
      headers: { authorization: `Bearer ${ctx.signAccessToken({ userId: viewer.id, email: viewer.email })}` },
    }));
    assert.equal(threadResponse.status, 404);

    const { POST: markThreadRead } = await import("../app/api/messages/thread/read/route");
    const readResponse = await markThreadRead(new ctx.NextRequest("http://localhost/api/messages/thread/read", {
      method: "POST",
      headers: {
        authorization: `Bearer ${ctx.signAccessToken({ userId: viewer.id, email: viewer.email })}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ with: counterpart.id }),
    }));
    assert.equal(readResponse.status, 404);

    const { PUT: markMessageRead } = await import("../app/api/messages/[id]/read/route");
    const messageReadResponse = await markMessageRead(new ctx.NextRequest(`http://localhost/api/messages/${message.id}/read`, {
      method: "PUT",
      headers: { authorization: `Bearer ${ctx.signAccessToken({ userId: viewer.id, email: viewer.email })}` },
    }), { params: Promise.resolve({ id: message.id }) });
    assert.equal(messageReadResponse.status, 404);

    const { DELETE: deleteMessage } = await import("../app/api/messages/[id]/route");
    const deleteResponse = await deleteMessage(new ctx.NextRequest(`http://localhost/api/messages/${message.id}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${ctx.signAccessToken({ userId: counterpart.id, email: counterpart.email })}` },
    }), { params: Promise.resolve({ id: message.id }) });
    assert.equal(deleteResponse.status, 404);
  } finally { await cleanupTag(ctx, tag, depot.id); }
});
