import { NextRequest, NextResponse } from "next/server";
import { verifyRefreshToken, signAccessToken, signRefreshToken, checkActive } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { err } from "@/lib/apiResponse";
import { blockRefreshToken, isRefreshTokenBlocked, storeRotationGrace, getRotationGrace, isUserForcedLogout } from "@/lib/tokenBlocklist";
import crypto from "crypto";

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function withAuthCookies(res: NextResponse, accessToken: string, refreshToken: string): NextResponse {
  const isProd = process.env.NODE_ENV === "production";
  res.cookies.set("accessToken", accessToken, {
    httpOnly: true,
    secure: isProd,
    sameSite: "strict",
    path: "/",
    maxAge: 900,
  });
  res.cookies.set("refreshToken", refreshToken, {
    httpOnly: true,
    secure: isProd,
    sameSite: "strict",
    path: "/api/auth",
    maxAge: 604800,
  });
  return res;
}

export async function POST(req: NextRequest) {
  const refreshToken = req.cookies.get("refreshToken")?.value;
  if (!refreshToken) return err("Refresh token required", 400);

  try {
    const payload = verifyRefreshToken(refreshToken);

    const issuedAt = typeof payload.iat === "number" ? payload.iat * 1000 : 0;
    if (!issuedAt || await isUserForcedLogout(payload.userId, issuedAt)) {
      return err("Session invalidated. Please sign in again.", 401);
    }

    // Reject if token has been revoked — unless we're inside the 30s rotation
    // grace window (A12): a concurrent tab that lost the rotation race gets
    // the SAME replacement pair instead of a broken session. Reuse after the
    // window stays 401.
    const tokenHash = hashToken(refreshToken);
    if (await isRefreshTokenBlocked(tokenHash)) {
      const grace = await getRotationGrace(tokenHash);
      if (grace) {
        return withAuthCookies(NextResponse.json({ ok: true }), grace.accessToken, grace.refreshToken);
      }
      return err("Token has been revoked", 401);
    }

    // Re-check the account state — refresh tokens last 7 days, but suspension,
    // deletion, or unverified status must take effect immediately, not whenever
    // the next refresh happens to fail.
    const dbUser = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { email: true, suspendedUntil: true, verified: true },
    });
    if (!dbUser) {
      await blockRefreshToken(tokenHash, 7 * 24 * 60 * 60);
      return err("Account not found", 401);
    }
    const activeErr = checkActive(dbUser);
    if (activeErr) {
      await blockRefreshToken(tokenHash, 7 * 24 * 60 * 60);
      return err(activeErr, 403);
    }
    if (!dbUser.verified) {
      await blockRefreshToken(tokenHash, 7 * 24 * 60 * 60);
      return err("Email not verified", 403);
    }

    // Rotate: sign the replacement pair, cache it in the grace window keyed by
    // the OLD token hash (BEFORE blocking, so a parallel request can never see
    // "blocked" without the grace entry existing), then revoke the old token.
    const decoded = JSON.parse(Buffer.from(refreshToken.split(".")[1], "base64url").toString());
    const ttlSeconds = Math.max(0, (decoded.exp ?? 0) - Math.floor(Date.now() / 1000));

    const newAccessToken = signAccessToken({ userId: payload.userId, email: payload.email });
    const newRefreshToken = signRefreshToken({ userId: payload.userId, email: payload.email });

    await storeRotationGrace(tokenHash, { accessToken: newAccessToken, refreshToken: newRefreshToken });
    if (!await blockRefreshToken(tokenHash, ttlSeconds)) {
      return err("Session security service temporarily unavailable", 503);
    }

    return withAuthCookies(NextResponse.json({ ok: true }), newAccessToken, newRefreshToken);
  } catch {
    return err("Invalid or expired refresh token", 401);
  }
}
