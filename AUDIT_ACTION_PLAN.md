# Audit Action Plan

> **Historical action plan:** Generated from the 2026-04-16 audit. Do not use
> this file as the current task list; use `HARON_LAUNCH_READINESS.md`, which
> reflects the current code and remaining verification gates.

Generated from `PRELAUNCH_AUDIT.md` — 2026-04-16.  
Fix these in order. HIGH items are launch-blockers.

---

## HIGH PRIORITY — Fix before launch

### H1 · Agreement race condition → unhandled 500
**File:** `app/api/swaps/[id]/agreement/route.ts`

The `findFirst` + `create` for new agreements is not atomic. When two requests race, the second hits the partial unique index constraint and crashes with a 500 instead of a 409.

**Fix:** Catch Prisma error code `P2002` on the `create` call and return `err("An agreement is already in progress for this swap", 409)`:
```ts
try {
  const agreement = await prisma.swapAgreement.create({ ... });
  // ...
} catch (e: unknown) {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
    return err("An agreement is already in progress for this swap", 409);
  }
  throw e;
}
```
Also import `{ Prisma }` from `@prisma/client`.

---

### H2 · Stored XSS in email templates
**File:** `app/api/messages/route.ts`

`senderName` and `text.trim()` are interpolated into HTML email body without escaping. Compare to `app/api/swaps/[id]/interest/route.ts` which correctly escapes `senderName`.

**Fix:** Add an HTML-escape helper (or copy the pattern from the interest route) and apply it to both `senderName` and `text` before interpolating into the email template:
```ts
function htmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
// then:
`<h2>New message from ${htmlEscape(senderName)}</h2>`
`<p>${htmlEscape(text.trim().slice(0, 300))}</p>`
```

---

### H3 · Block user — no enforcement
**Files:** `app/api/users/[id]/block/route.ts`, `prisma/schema.prisma`

The block action logs to audit trail but has no data model and is not enforced anywhere. A worker who blocks a harasser continues receiving messages from them.

**Fix options (choose one):**

**Option A — Minimal (stub block, prevent messages only):**
1. Add `Block` model to schema: `blockerId`, `blockedId`, unique pair, timestamps
2. Add migration
3. In `POST /api/users/:id/block`: create/upsert the Block row (idempotent)
4. In `POST /api/messages` and `POST /api/swaps/:id/interest`: check if a block exists in either direction before creating the message

**Option B — Defer and hide the button:**
Remove the block UI button entirely until Option A is implemented. A non-working safety feature is worse than a missing one.

---

### H4 · Sentry Replay captures PII without masking
**File:** `sentry.client.config.ts`

100% of error sessions and 5% of all sessions are recorded as full interaction replays with no input masking. This sends typed passwords, private message content, and swap schedule data to Sentry.

**Fix:**
```ts
Sentry.init({
  // ...existing config...
  integrations: [
    Sentry.replayIntegration({
      maskAllInputs: true,
      maskAllText: true,
      blockAllMedia: true,
    }),
  ],
});
```

---

### H5 · TWU non-affiliation disclaimer
**Files:** Login page, home/landing page, Privacy Policy

There is no visible statement that the app is not affiliated with TWU Local 100 or the MTA.

**Fix:** Add a one-line disclaimer to the login screen footer and the Privacy Policy:
> "We Move NY is not affiliated with, endorsed by, or operated by TWU Local 100 or the MTA."

---

## MEDIUM PRIORITY — Fix within 2 weeks of launch

### M1 · Logout-all doesn't invalidate access tokens
**File:** `app/api/auth/logout-all/route.ts`

The route bumps `user.updatedAt` but nothing checks `updatedAt` during token validation. Active sessions remain valid for up to 15 minutes after logout-all.

**Fix (preferred):** Add `tokenVersion Int @default(0)` to the `users` model. Increment it in `logout-all`. Include `tokenVersion` in the JWT payload when signing. Verify it matches the DB value in `requireUser()`.

**Alternative (simpler, weaker):** Accept the 15-minute window as acceptable given the short access token lifetime. Document the limitation.

---

### M2 · Swap PUT doesn't re-validate dates
**File:** `app/api/swaps/[id]/route.ts` (PUT handler)

Editing an existing swap doesn't validate that the new date is in the future or within 1 year.

**Fix:** Extract the date validation block from `POST /api/swaps` into a shared utility and call it from the PUT handler too.

---

### M3 · Cron job timezone mismatch
**File:** `vercel.json`

Cron runs at midnight UTC, which is 7–8 PM New York time. Swaps for "tomorrow" expire the evening before.

**Fix:** Change the expire-swaps cron to `0 5 * * *` (= midnight EST) or `0 4 * * *` (= midnight EDT):
```json
{ "path": "/api/cron/expire-swaps", "schedule": "0 5 * * *" }
```
Or if seasonal accuracy matters, implement timezone-aware comparison in the route itself.

---

### M4 · No staging environment

**Fix:**
1. Create a Neon branch named `preview` from the production branch
2. In Vercel project settings → Environment Variables, add preview-environment overrides pointing to the preview Neon DB URL
3. Test all migrations on the preview branch before applying to production

---

### M5 · No rollback runbook

**Fix:** Create `RUNBOOK.md` documenting:
- How to roll back a Vercel deployment (`vercel rollback` or Deployments tab)
- How to restore Neon DB from a point-in-time snapshot
- How to enable maintenance mode (`MAINTENANCE_MODE=true` in Vercel env)
- On-call contact list

---

### M6 · Rate limit fails open on Redis outage
**File:** `lib/rateLimit.ts`

When Redis is unavailable, all rate limits return `true` (allow). This was a real issue in production.

**Fix:** Add Sentry alerting when the Redis fallback fires, so you know when brute-force protection is down:
```ts
} catch (e) {
  if (process.env.NODE_ENV === "production") {
    Sentry.captureException(e, { level: "warning", tags: { source: "rateLimit" } });
  }
  return true; // fail open — alert sent
}
```

---

### M7 · Data export has no rate limit
**File:** `app/api/users/me/export/route.ts`

No rate limit on the full-data export endpoint.

**Fix:** Add `rateLimit(`export:${user.userId}`, 5, 3_600_000)` — 5 exports per hour per user.

---

### M8 · CSP missing form-action directive
**File:** `next.config.ts`

Missing `form-action 'self'` allows HTML forms to submit to external URLs.

**Fix:** Add `"form-action 'self'"` to the CSP array in `next.config.ts`.

---

### M9 · GTM/GA disclosure
**Files:** Privacy Policy, app landing/login pages

GTM and Google Analytics are active and users are not explicitly informed.

**Fix:** Add to Privacy Policy: list GTM/GA as third-party analytics, describe what data is collected (page views, events), and provide an opt-out mechanism (or link to Google's opt-out). Consider providing a session-level opt-out for workers who are concerned about monitoring.

---

### M10 · Content moderation path
**File:** Admin reports dashboard

Current: manual admin review only.

**Fix for launch:** Ensure the admin reports queue is actively monitored (set up an email notification when a new report is submitted). For post-launch scale: evaluate automated flagging for common abuse patterns in `details` field.

---

### M11 · Poster name visibility in swap list
**File:** `app/api/swaps/route.ts`

`posterName` is always returned in swap list responses.

**Fix (optional):** Add a `hideName` boolean field to the swap model that replaces `posterName` with "Anonymous" in list responses while still showing it to the swap owner. Offer this as an option on the post form.

---

## LOW PRIORITY / VERIFY MANUALLY

### L1 · npm audit
Run `npm audit` in the project directory before launch. Resolve any critical or high severity findings.

### L2 · iOS apple-touch-icon meta tags
Verify `<link rel="apple-touch-icon" href="/icons/icon-192.png">` is present in `app/layout.tsx`. Without it, iOS home screen icon will be a blurry screenshot.

### L3 · JWT_RESET_SECRET in CI
Add `JWT_RESET_SECRET` to `.github/workflows/ci.yml` environment variables (use a placeholder value, same as other secrets). Prevents potential CI failures if the variable is accessed at build time.

### L4 · Admin 2FA
VERIFY MANUALLY in Vercel/Neon dashboards: confirm admin accounts have two-factor authentication enabled. Application-level 2FA is not implemented (acceptable for Phase 1 given invite-code gating, but plan for Phase 2).

### L5 · Phase 2 PII architecture
Before starting Phase 2 insurance/benefits work: document the data flow, choose a storage isolation strategy (separate schema or DB), update the Privacy Policy, and assess SOC 2 applicability.

### L6 · Sentry PII in server-side traces
The server Sentry config (`sentry.server.config.ts`) does not strip PII from traces. Verify Sentry project settings have "Data Scrubbing" enabled and that PII fields (email, names) are not captured in breadcrumbs or exception contexts.

### L7 · Push notification iOS testing
VERIFY MANUALLY: Test push notification opt-in flow on an iOS 16.4+ device with the app added to the home screen. The push permission prompt will not appear in Safari in-browser.

---

## ALREADY DONE (from prior security session)

These were completed 2026-04-16 and are in production:
- ✅ `checkActive()` — suspension/deletion check on all write routes
- ✅ IDOR fix on reputation endpoint (depot scoping)
- ✅ Category enum validation on swap create
- ✅ Rate limit on reputation, agreement, feedback endpoints
- ✅ Reset token single-use enforcement via Redis blocklist
- ✅ Timing-safe forgot-password (400ms minimum response)
- ✅ Announcement expiresAt validation
- ✅ Swap date validation (future-only, 1-year max)
- ✅ Contact field format validation (phone or email only)
- ✅ Failed login audit logging
- ✅ Message.text VARCHAR(2000) migration
- ✅ Bulk admin role/suspend endpoint with transaction
- ✅ Audit log on admin data export
- ✅ Cursor-based pagination on notifications
- ✅ Normalised duplicate swap detection
