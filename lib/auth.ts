import jwt from "jsonwebtoken";
import { NextRequest } from "next/server";

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required environment variable: ${name}`);
  return val;
}

// Lazy getters — checked at call time, not module load, so builds don't fail
// when env vars are absent (they will fail loudly at runtime instead).
const getAccessSecret = () => requireEnv("JWT_SECRET");
const getRefreshSecret = () => requireEnv("JWT_REFRESH_SECRET");
const getResetSecret = () => requireEnv("JWT_RESET_SECRET");

export interface TokenPayload {
  userId: string;
  email: string;
  iat?: number;
}

export function signAccessToken(payload: TokenPayload): string {
  return jwt.sign(payload, getAccessSecret(), { expiresIn: "15m" });
}

export function signRefreshToken(payload: TokenPayload): string {
  return jwt.sign(payload, getRefreshSecret(), { expiresIn: "7d" });
}

export function verifyAccessToken(token: string): TokenPayload {
  return jwt.verify(token, getAccessSecret()) as TokenPayload;
}

export function verifyRefreshToken(token: string): TokenPayload {
  return jwt.verify(token, getRefreshSecret()) as TokenPayload;
}

export function getTokenFromRequest(req: NextRequest): string | null {
  // Prefer HttpOnly cookie (XSS-safe); fall back to Authorization header
  const cookie = req.cookies.get("accessToken")?.value;
  if (cookie) return cookie;
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7);
  return null;
}

export function getUserFromRequest(req: NextRequest): TokenPayload | null {
  const token = getTokenFromRequest(req);
  if (!token) return null;
  try {
    return verifyAccessToken(token);
  } catch {
    return null;
  }
}

export function requireUser(req: NextRequest): TokenPayload {
  const user = getUserFromRequest(req);
  if (!user) throw new Error("UNAUTHORIZED");
  return user;
}

/**
 * Returns an error message if the account is deleted or suspended, null otherwise.
 * Call this after fetching the user from DB on any write route.
 */
export function checkActive(user: { email: string; suspendedUntil: Date | null }): string | null {
  if (user.email.endsWith("@deleted.invalid")) return "Account not found";
  if (user.suspendedUntil && user.suspendedUntil > new Date()) {
    const mins = Math.ceil((user.suspendedUntil.getTime() - Date.now()) / 60_000);
    return `Account suspended. Try again in ${mins} minute${mins !== 1 ? "s" : ""}.`;
  }
  return null;
}

// Separate secret for password-reset tokens — compromise of ACCESS_SECRET
// cannot be used to forge reset tokens and vice versa.
export function signResetToken(userId: string): string {
  return jwt.sign({ userId, type: "reset" }, getResetSecret(), { expiresIn: "1h" });
}

export function verifyResetToken(token: string): { userId: string } {
  const payload = jwt.verify(token, getResetSecret()) as { userId: string; type: string };
  if (payload.type !== "reset") throw new Error("Invalid token type");
  return { userId: payload.userId };
}
