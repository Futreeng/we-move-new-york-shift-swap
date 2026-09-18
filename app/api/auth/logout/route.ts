import { NextRequest, NextResponse } from "next/server";
import { blockRefreshToken } from "@/lib/tokenBlocklist";
import crypto from "crypto";

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function POST(req: NextRequest) {
  const refreshToken = req.cookies.get("refreshToken")?.value;

  if (refreshToken) {
    try {
      const decoded = JSON.parse(Buffer.from(refreshToken.split(".")[1], "base64url").toString());
      const ttlSeconds = Math.max(0, (decoded.exp ?? 0) - Math.floor(Date.now() / 1000));
      if (!await blockRefreshToken(hashToken(refreshToken), ttlSeconds)) {
        const res = NextResponse.json({ error: "Session security service temporarily unavailable" }, { status: 503 });
        res.cookies.set("accessToken", "", { httpOnly: true, secure: true, sameSite: "strict", path: "/", maxAge: 0 });
        res.cookies.set("refreshToken", "", { httpOnly: true, secure: true, sameSite: "strict", path: "/api/auth", maxAge: 0 });
        return res;
      }
    } catch { /* non-fatal — token may be expired already */ }
  }

  const res = NextResponse.json({ loggedOut: true });

  // Clear both cookies
  res.cookies.set("accessToken", "", { httpOnly: true, secure: true, sameSite: "strict", path: "/", maxAge: 0 });
  res.cookies.set("refreshToken", "", { httpOnly: true, secure: true, sameSite: "strict", path: "/api/auth", maxAge: 0 });

  return res;
}
