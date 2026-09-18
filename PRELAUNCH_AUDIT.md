# We Move NY — Pre-Launch Audit Report

> **Historical snapshot:** This report was written on 2026-04-16 and is not the
> current launch status. Several findings below were subsequently fixed. Use
> `HARON_LAUNCH_READINESS.md` as the current implementation and release gate.

**Date:** 2026-04-16  
**Auditor:** Claude Code (automated, human-reviewed)  
**Scope:** Functional QA · Security · Pre-Launch Ops · Shift-Swap–Specific  
**Files read:** 60+ source files, all migrations, full schema, CI/CD config  
**Status legend:** ✅ IN PLACE · ⚠️ PARTIAL OR INCORRECT · ❌ MISSING · 🔍 UNABLE TO VERIFY

---

## EXECUTIVE SUMMARY

The codebase is well-engineered for a pre-launch product. Auth is solid, most security headers are present, rate limiting is wired, and the schema is thoughtfully modeled. However there are **four issues that should be fixed before launch**: a race condition in agreement creation that produces ugly 500 errors instead of 409s, stored XSS vectors in outbound email HTML, a "block user" feature that is UI-only with no enforcement, and Sentry Replay capturing sensitive content (messages, swap details) without masking.

---

## PART 1: FUNCTIONAL QA

### 1.1 Concurrent Claim Handling

**Status: ⚠️ PARTIAL — race condition handled at DB level but not in app code**  
**Priority: HIGH**

The agreement creation flow (`POST /api/swaps/:id/agreement`) does:
1. `findFirst` — checks for existing active agreement (status pending or userA_confirmed)
2. `create` — creates new agreement

These two steps are **not in a database transaction**. Two simultaneous requests can both pass the `findFirst` check before either writes. The partial unique index added in migration `20260414_agreement_unique_active` prevents duplicate rows at the DB level:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS "swap_agreements_swap_id_active_key"
  ON "swap_agreements" ("swap_id")
  WHERE status IN ('pending', 'userA_confirmed');
```

This is the right safeguard, but when two requests race, the second will receive an **unhandled Prisma unique constraint error** that becomes a `500 Internal Server Error` instead of the intended `409 Conflict`. The user sees a crash rather than a sensible message.

**What to fix:** Wrap the check + create in `prisma.$transaction`, or catch the `P2002` Prisma error code and return `409`.

---

### 1.2 Shift Post → Claim → Confirm Flow

**Status: ✅**

The flow is coherent:
- POST `/api/swaps` creates a swap with `status: open`
- POST `/api/swaps/:id/agreement` proposes an agreement, transitions swap to `pending`
- PATCH `/api/swaps/:id/agreement` with `action: confirm` (by swap owner) transitions to `completed` and swap to `filled`
- PATCH with `action: cancel` reverts swap to `open`

The state machine is functionally correct for the two-party model.

---

### 1.3 Cancellation Logic

**Status: ✅**

Pre-claim cancellation: swap owner can DELETE `/api/swaps/:id`.  
Post-claim cancellation: either party can cancel via PATCH `action: cancel`, which reverts swap status to `open` and notifies the other party.  
Status transitions are validated server-side.

---

### 1.4 Past-Date Prevention

**Status: ✅ (POST), ❌ (PUT)**  
**Priority: MEDIUM**

`POST /api/swaps` rejects dates in the past and dates more than 1 year out.  
`PUT /api/swaps/:id` (edit swap) does **not** re-validate dates — a user can edit an existing swap and set the date to yesterday. Fix by reusing the same date validation logic in the PUT handler.

---

### 1.5 Timezone Handling

**Status: ⚠️ PARTIAL**  
**Priority: LOW**

Swap dates are stored as UTC timestamps. The cron job `expire-swaps` runs at `0 0 * * *` (midnight UTC). For New York (UTC-5 in winter, UTC-4 in summer), this means the expiry job fires at **7–8 PM New York time** — swaps for "tomorrow" expire the evening before. This is confusing UX for workers checking if a swap they posted for the next morning is still active.

**Recommendation:** Run the expire cron at `0 5 * * *` (UTC) = midnight EST, or add timezone-aware date handling so "same-day expiry" happens at midnight in the worker's local time.

---

### 1.6 Email Verification Enforcement

**Status: ✅**

Login route checks `dbUser.verified` and returns 403 if the user has not verified their email. Unverified users cannot post or claim swaps.

---

### 1.7 Session Handling

**Status: ✅**

- Access token: 15-minute HttpOnly cookie
- Refresh token: 7-day HttpOnly cookie, path-narrowed to `/api/auth`
- Token rotation on every refresh (old token blocklisted in Redis)
- Auto-refresh on 401 in the client API wrapper

---

### 1.8 Logout Completeness

**Status: ⚠️ PARTIAL**  
**Priority: MEDIUM**

`POST /api/auth/logout-all` claims to invalidate all sessions by bumping `user.updatedAt`. The code comment says this can be "checked at token refresh time to reject stale tokens" — but **no such check exists** in the refresh route. The refresh route only checks the Redis blocklist. A stolen access token remains valid for up to 15 minutes after logout-all. A stolen refresh token remains valid indefinitely until it expires in 7 days, because the blocklist check won't catch it.

The logout-all should either: (a) blocklist all active refresh tokens (requires tracking them), or (b) add a `tokenVersion` int to the user model, increment it on logout-all, and verify `tokenVersion` in the JWT payload.

**Note:** Single-device logout via `POST /api/auth/logout` (which presumably clears the cookies) works correctly. This is only a concern for "logout all devices."

---

### 1.9 PWA Manifest

**Status: ✅**

`manifest.json` is complete:
- `name`, `short_name`, `start_url`, `display: standalone`, `orientation: portrait`
- `theme_color` and `background_color` set
- 8 icon sizes (72–512px) with `purpose: maskable` on larger sizes

---

### 1.10 Service Worker

**Status: ✅**

`public/sw.js` implements:
- Cache-first for app shell (`/`, `/login`, `/depots`, `/_next/static/`, icons)
- Network-only for all `/api/` calls (no stale data risk)
- Network-first for navigation with shell fallback (works offline)
- Cache versioning with cleanup on activate

---

### 1.11 iOS Safari Compatibility

**Status: ✅ (manifest) · 🔍 VERIFY MANUALLY (splash screens)**

Manifest is correctly configured for iOS Add-to-Home-Screen. However, iOS Safari does not use `maskable` icons from the manifest — it uses `apple-touch-icon` meta tags. 

**VERIFY MANUALLY:** Check that `<link rel="apple-touch-icon">` tags are present in the root layout. If missing, iOS will use a low-quality screenshot as the home screen icon.

---

### 1.12 Push Notifications (iOS 16.4+)

**Status: ✅**

Web Push is implemented with VAPID keys. Service worker handles `push` events and notification clicks with deep-link navigation. Non-fatal error handling prevents notification failures from breaking main flows.

**VERIFY MANUALLY:** Test on iOS 16.4+ in Safari — push permission prompt only appears when the app is added to the home screen. Users browsing in-browser will not see the push prompt on iOS.

---

## PART 2: SECURITY

### 2.1 Authentication — JWT Implementation

**Status: ✅**

- Three separate signing secrets (access / refresh / reset) — correct, prevents cross-type exploitation
- Short-lived access tokens (15 min) with longer refresh tokens (7 days)
- HttpOnly, secure, sameSite=strict cookies in production
- Refresh token path-narrowed to `/api/auth` — correct
- Token rotation on each refresh (old token blocklisted)
- Reset tokens are single-use (Redis NX atomic consume)

---

### 2.2 Password Policy

**Status: ✅**

- Minimum 12 characters, maximum 128
- Must contain letters + numbers OR special characters
- Bcrypt hashing

---

### 2.3 Email Enumeration

**Status: ✅**

`POST /api/auth/forgot-password` returns the same message whether the email exists or not, with a minimum 400ms response time to prevent timing-based enumeration.

---

### 2.4 Rate Limiting

**Status: ✅ (coverage) · ⚠️ (fail-open)**

Rate limits applied to:
- Login: 10/min per IP
- Register: 5/hour per IP
- Forgot-password: 5/15min per IP
- Reset-password: 5/15min per IP
- Messages: 5/min per user
- Swap posts: 5/hour per user, 30/hour per IP
- Agreement creation: 3/hour per user per swap
- Feedback: 5/hour per user

**Gap:** The rate limiter **fails open** — if Redis is unreachable, all rate limits are disabled and every request is allowed through. This was observed in production during this session where Redis had a bad URL. Consider adding circuit-breaker logging/alerting when Redis falls back.

**Gap:** No rate limit on `GET /api/users/me/export` — a user could call this in a tight loop. Add 1/hour limit.

---

### 2.5 Account Lockout

**Status: ✅**

10 consecutive failed login attempts lock the account for 15 minutes. Failed attempts are logged to the audit log.

---

### 2.6 STORED XSS IN EMAIL TEMPLATES

**Status: ❌ FINDING**  
**Priority: HIGH**

Two API routes build HTML email content by interpolating user-controlled strings directly into HTML without escaping:

**`app/api/messages/route.ts` (lines ~60–63):**
```ts
`<h2>New message from ${senderName}</h2>`
`<p>${text.trim().slice(0, 300)}</p>`
```
Both `senderName` (firstName + lastName from registration) and `text` (user-typed message content) are injected into HTML without escaping. A user named `<img src=x onerror=alert(1)>` or who sends a message containing HTML would inject content into the email received by the swap poster.

Compare this to `app/api/swaps/[id]/interest/route.ts` which **correctly** escapes `senderName`:
```ts
const escapedSenderName = senderName.replace(/&/g, "&amp;").replace(/</g, "&lt;")...
```

**Fix:** Apply the same HTML-escaping to `senderName` and `text` in `messages/route.ts`.

**Note:** Modern email clients don't execute `<script>` tags, but `<img onerror>`, `<a href="javascript:">`, and CSS injection (via style attributes) are all exploitable in many clients. More importantly, a malicious sender could craft a message that looks like a phishing email to the recipient (fake button, fake text, etc.), especially since the email body appears to be the full HTML shown.

---

### 2.7 Block User — Not Enforced

**Status: ❌ FINDING**  
**Priority: HIGH**

`POST /api/users/:id/block` writes to `auditLog` using `action: "block_user"` but:
1. There is **no `Block` model** in `schema.prisma`
2. The block is **never checked** in messages, interest, or agreement routes
3. A "blocked" user can still send messages to the blocker, propose agreements, and see the blocker's swaps

The block action is UI theater. Either implement it properly (Block model + enforcement in write routes) or remove the block button from the UI until it's ready.

---

### 2.8 Sentry Replay — PII Exposure

**Status: ⚠️ PARTIAL**  
**Priority: HIGH**

`sentry.client.config.ts` captures:
- 100% of error sessions as full user interaction replays (`replaysOnErrorSampleRate: 1.0`)
- 5% of all sessions (`replaysSessionSampleRate: 0.05`)

There is **no `maskAllInputs`, `maskAllText`, or `block` configuration**. This means Sentry records:
- Typed passwords (input fields are not masked)
- Private message content (the messaging UI)
- Swap details (potentially sensitive shift schedules)
- Any other user interaction

For a transit worker app where employer surveillance is an explicit threat model concern, recording full session replays and sending them to a third-party service (Sentry) is a significant privacy risk. Workers may be uncomfortable if they learn their typed messages and swap patterns are being replayed by the app operator.

**Fix:** At minimum, add `maskAllInputs: true` and mask text in message/swap areas:
```ts
Sentry.replayIntegration({
  maskAllInputs: true,
  maskAllText: true,
  blockAllMedia: true,
})
```
Or reduce `replaysSessionSampleRate` to `0` and only capture error replays with masking.

---

### 2.9 Security Headers

**Status: ✅ (mostly) · ⚠️ (CSP gaps)**

All major headers are present and correctly configured:
- `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` ✅
- `X-Content-Type-Options: nosniff` ✅
- `X-Frame-Options: DENY` (redundant with `frame-ancestors 'none'` in CSP, but harmless) ✅
- `Referrer-Policy: strict-origin-when-cross-origin` ✅
- `Permissions-Policy: camera=(), microphone=(), geolocation=()` ✅

**CSP gaps:**
- `script-src` includes `'unsafe-inline'` and `'unsafe-eval'` — required by Next.js and Sentry but weakens XSS protection. Consider nonce-based CSP for production hardening (post-launch).
- `img-src https:` allows images from any HTTPS origin — broad but typical for avatar/logo use cases.
- `connect-src` includes `https://www.googletagmanager.com` — GTM can make arbitrary network connections. Verify what GTM is actually sending.
- **Missing `form-action 'self'`** — without this directive, HTML forms can be submitted to external URLs. Add `form-action 'self'` to the CSP.

---

### 2.10 Google Tag Manager

**Status: ⚠️ FLAGGED FOR REVIEW**  
**Priority: MEDIUM**

GTM is allowed in `script-src` and `connect-src`. GTM can load arbitrary third-party scripts at runtime, effectively bypassing all CSP script restrictions. Any script injected via GTM can access cookies (not HttpOnly ones), localStorage, DOM content including message text, and send data anywhere.

For a privacy-sensitive app used by workers worried about employer surveillance, tracking via GTM/GA should be disclosed prominently in the Privacy Policy, with opt-out available. Verify what tags/triggers are active in the GTM container.

---

### 2.11 Secrets Management

**Status: ✅**

- `.env.local` and `.env*` are in `.gitignore`
- No hardcoded secrets found in source code
- Docker Compose uses development-only credentials
- All production secrets are environment variables
- No `service_role` keys (project uses Prisma/Neon, not Supabase client)
- `NEXT_PUBLIC_` prefix used only for: app URL, Sentry DSN, VAPID public key — all appropriate

---

### 2.12 Input Validation

**Status: ✅ (server-side present) · ⚠️ (inconsistent)**

Server-side validation exists on all primary write routes. However coverage is not uniform:
- Swap POST: full validation (category enum, date ranges, contact format, length limits) ✅
- Swap PUT (edit): missing date re-validation ⚠️
- Messages: length check present, but no profanity filter or abuse-pattern detection ⚠️ (by design — acceptable)

---

### 2.13 IDOR / Authorization

**Status: ✅**

- Swap read/write scoped to `depotId` — users can only see swaps at their depot
- Reputation endpoint scoped to same depot
- Agreements: only participants can view/modify
- Admin routes: `role` checks on all endpoints
- Depot rep dashboard: scoped to own depot

---

### 2.14 SQL Injection

**Status: ✅**

All database access is through Prisma ORM with parameterized queries. No raw SQL except `prisma.$queryRaw`SELECT 1`` (health check, safe literal).

---

### 2.15 CSRF

**Status: ✅**

Cookies are `sameSite: strict`, which is the correct defense against CSRF. No additional CSRF token needed.

---

### 2.16 Dependency Vulnerabilities

**Status: 🔍 UNABLE TO VERIFY (node not in PATH)**

npm is not available in the audit environment. Key dependencies by version:
- `next@16.2.3` — current major
- `@prisma/client@7.7.0` — current
- `jsonwebtoken@9.0.3` — current
- `bcryptjs@3.0.3` — current
- `web-push@3.6.7` — current
- `@sentry/nextjs@10.47.0` — current
- `@upstash/redis@1.37.0` — current

**VERIFY MANUALLY:** Run `npm audit` in the project directory before launch. Pay particular attention to `jsonwebtoken` (had a critical CVE in v8) and `web-push`.

---

### 2.17 PII Collection and Handling

**Status: ✅ (minimized) · ⚠️ (Sentry — see 2.8)**

PII collected: first name, last name, email, depot affiliation. No phone number, address, SSN, or payment information in Phase 1. Data export endpoint exists (`GET /api/users/me/export`). Self-deletion endpoint exists with password confirmation (`POST /api/users/me/delete`). Soft-delete anonymizes to `deleted_<id>@deleted.invalid` and wipes personal fields.

**Gap:** The data export has no rate limit. A malicious actor who compromises an account could export all messages (up to 1000) and swap history in a loop.

---

### 2.18 Audit Logging

**Status: ✅ (admin actions) · ⚠️ (user actions)**

Admin actions logged: role changes, invite management, report handling, user deletion.  
User actions logged: self-deletion, failed logins, block actions.  
**Not logged:** Swap creation, swap deletion, agreement creation/completion. This is fine for now but worth adding for Phase 2 compliance.

---

## PART 3: PRE-LAUNCH OPS

### 3.1 Error Tracking

**Status: ✅**

Sentry is configured on both client and server with 20% trace sampling and 100% error replay capture. Errors will surface in production. See finding 2.8 for replay PII concerns.

---

### 3.2 Analytics

**Status: ✅ · ⚠️ (privacy disclosure)**

Google Tag Manager and Google Analytics are configured via CSP allowlist. Whether specific conversion events (first swap, notification opt-in) are wired up in GTM is not verifiable from source code.

**VERIFY MANUALLY:** Confirm GTM has events for: user registration, first swap posted, first swap agreement, push notification opt-in. These are the key Phase 1 activation metrics.

---

### 3.3 Staging Environment

**Status: ❌ MISSING**  
**Priority: MEDIUM**

There is no staging environment configured. Vercel branch previews exist by default but there is no `.env.preview` file or separate Neon branch for testing. All testing is happening against production.

**Recommendation:** Create a Neon branch for preview deployments and configure Vercel preview environment variables to point to it. This enables testing migrations and features without risk to production data.

---

### 3.4 CI/CD

**Status: ✅ · ⚠️ (missing secret)**

`.github/workflows/ci.yml` runs on push and PRs: `npm ci → prisma generate → npm run build`. Build secrets are properly masked.

**Gap:** `JWT_RESET_SECRET` is not in the CI environment variables. If it's required at build time (it shouldn't be — JWT signing is runtime), the build would fail. Verify it's not needed at build time or add it.

---

### 3.5 Terms of Service and Privacy Policy

**Status: ✅**

`/app/terms/page.tsx` and `/app/privacy/page.tsx` exist. Content not read — verify they accurately describe:
- Data collected (names, email, shift data)
- Third-party services (Sentry, Google Analytics/GTM, Resend)
- Worker privacy protections (no employer access)
- Data retention and deletion policy

---

### 3.6 Support Path

**Status: 🔍 UNABLE TO VERIFY**

No dedicated support route or contact form was found in the API. **VERIFY MANUALLY:** Confirm there is a visible support contact (email or link) on the app for users who have problems or want to report abuse.

---

### 3.7 Rollback Plan

**Status: ❌ NOT DOCUMENTED**  
**Priority: MEDIUM**

No documented rollback procedure found. For launch:
- Vercel: instant rollback via dashboard (`vercel rollback`) or via the Deployments tab
- Database: Neon branching enables point-in-time restore; document the recovery procedure
- **Recommend:** Document in a `RUNBOOK.md` the exact steps to roll back a bad deployment and restore from a DB snapshot

---

### 3.8 Maintenance Mode

**Status: ✅**

Middleware gates all traffic to `/maintenance` when `MAINTENANCE_MODE=true`. Health check and static assets bypass the gate.

---

## PART 4: SHIFT-SWAP–SPECIFIC

### 4.1 TWU Non-Affiliation Disclaimer

**Status: 🔍 UNABLE TO VERIFY**  
**Priority: HIGH**

No disclaimer was found in API routes or in public-facing static content. **VERIFY MANUALLY** that a visible notice on the login page and/or home screen states the app is not affiliated with or endorsed by TWU Local 100 or the MTA. Without this, workers may mistakenly believe the union operates or endorses the platform, or that their swap data is protected by union agreements.

---

### 4.2 Content Moderation

**Status: ⚠️ PARTIAL**  
**Priority: MEDIUM**

Report flow exists (`POST /api/swaps/:id/report`, reason field, admin review dashboard). However:
- No automated content scanning on swap `details` or `contact` fields
- No moderation for messages between users
- Admin report review route exists but moderation workflow is manual

For 500 users, manual review is workable. Plan for automation before scaling.

---

### 4.3 Data Scraping / Pattern Analysis

**Status: ⚠️**  
**Priority: MEDIUM**

The swap board is depot-scoped (only users at the same depot can see swaps). This limits the blast radius of a scraping attack. However:
- The swap list API (`GET /api/swaps`) returns `posterName` in responses. Any authenticated depot member can paginate through all swaps and extract which workers are repeatedly swapping specific routes/runs, which could reveal schedule patterns to coworkers or, if credentials are compromised, to management.
- Swap `details` can contain personal scheduling information typed by workers.

**Recommendation:** Consider adding a "hide poster name" option for workers who want to swap anonymously, or at minimum document in the Privacy Policy that swap postings are visible to all depot members.

---

### 4.4 Blocking — Incomplete (see 2.7)

The block feature surfaces in the UI but has no enforcement. This is a safety concern: a worker who blocks a harassing coworker will believe they are protected but will continue receiving messages.

---

### 4.5 Phase 2 Insurance / PII Readiness

**Status: 🔍 PLAN NOW**  
**Priority: MEDIUM**

Current PII surface (Phase 1): name, email, depot, shift schedule patterns.  
Phase 2 will add insurance/benefits data: health plan selection, beneficiary info, potentially SSN/DOB.

**Architectural recommendation:**
- Isolate Phase 2 insurance data in a separate schema or database with its own access controls
- Do not co-locate insurance data in the `users` table
- Establish a documented data flow diagram before collecting any Phase 2 PII
- Ensure the Privacy Policy is updated before Phase 2 beta begins
- Consider SOC 2 readiness assessment before Phase 2

---

## SUMMARY TABLE

| # | Finding | Domain | Priority | Status |
|---|---------|--------|----------|--------|
| 1 | Agreement race condition → unhandled 500 | Functional | HIGH | ⚠️ |
| 2 | Stored XSS in email templates (messages/route.ts) | Security | HIGH | ❌ |
| 3 | Block user not enforced at data layer | Security | HIGH | ❌ |
| 4 | Sentry Replay captures PII without masking | Security | HIGH | ⚠️ |
| 5 | TWU non-affiliation disclaimer missing | App-Specific | HIGH | 🔍 |
| 6 | Logout-all doesn't invalidate access tokens | Security | MEDIUM | ⚠️ |
| 7 | Swap PUT doesn't re-validate dates | Functional | MEDIUM | ❌ |
| 8 | Cron jobs fire at wrong time for NYC timezone | Functional | MEDIUM | ⚠️ |
| 9 | No staging environment | Ops | MEDIUM | ❌ |
| 10 | No rollback runbook | Ops | MEDIUM | ❌ |
| 11 | Rate limit fails open (Redis outage) | Security | MEDIUM | ⚠️ |
| 12 | Data export endpoint has no rate limit | Security | MEDIUM | ❌ |
| 13 | CSP missing form-action directive | Security | MEDIUM | ❌ |
| 14 | GTM/GA in privacy-sensitive context undisclosed | App-Specific | MEDIUM | ⚠️ |
| 15 | Content moderation workflow manual only | App-Specific | MEDIUM | ⚠️ |
| 16 | Poster name visible in swap list (pattern analysis) | App-Specific | MEDIUM | ⚠️ |
| 17 | iOS apple-touch-icon meta tags not verified | Functional | LOW | 🔍 |
| 18 | npm audit not run — dep vulns unverified | Security | LOW | 🔍 |
| 19 | JWT_RESET_SECRET missing from CI env | Ops | LOW | ⚠️ |
| 20 | Phase 2 PII architecture not planned | App-Specific | LOW | 🔍 |
