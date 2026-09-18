# We Move NY Shift Swap: Launch Readiness Handoff

**Prepared for:** Haron
**Prepared by:** Independent project evaluation
**Evaluation date:** 2026-09-18
**Decision:** **NO-GO for safe public launch**

## Executive Decision

The application has a solid amount of implemented functionality, but it is not yet possible to certify it as 100% launch-ready. The most important reasons are:

1. Global logout is not reliably enforced for all token paths.
2. Blocked users can still read existing conversation threads unless this is explicitly approved as an evidence-retention policy.
3. The full database and Redis test coverage has not been proven in this environment; critical tests were skipped.
4. Production dependency vulnerabilities require triage.
5. Staging, live infrastructure, deployment, migration, device, email, push, and rollback checks still require evidence from the actual deployment environment.

Do not treat a green unit-test subset as launch approval. Launch approval requires the blocker fixes below plus the evidence checklist at the end of this document.

## Launch Blockers

### B1. Fix global logout and token revocation

**Severity:** Critical security issue

**Evidence:**

- `app/api/auth/logout-all/route.ts` updates `user.updatedAt` and attempts to block access tokens.
- `app/api/auth/refresh/route.ts` checks refresh-token blocklisting, but does not compare token issuance against `updatedAt` or a token version.
- `middleware.ts` only reads the access-token cookie when applying force-logout. Requests using the supported `Authorization: Bearer ...` path can bypass that middleware check.
- The refresh route does not consult the force-logout marker.

**Risk:** A stolen refresh token may remain usable for up to seven days, and a stolen bearer access token may remain usable until expiry or bypass the middleware revocation path.

**Required fix:** Choose and implement one complete revocation design:

- Add a `tokenVersion` to `User`.
- Include the version in access and refresh JWTs.
- Increment it on logout-all, password reset, account deletion, suspension, and role demotion where appropriate.
- Verify it in both access-token authorization and refresh-token rotation.
- Ensure cookie and bearer-token requests use the same authorization and revocation checks.

A Redis-only design is acceptable only if every token type and every supported transport is covered and tested.

**Acceptance evidence:**

- A test proves logout-all rejects an old cookie access token.
- A test proves logout-all rejects an old bearer access token.
- A test proves logout-all rejects an old refresh token.
- A test proves password reset, suspension, deletion, and role demotion revoke sessions according to the intended policy.

### B2. Define and enforce blocking behavior for conversation reads

**Severity:** High safety/privacy issue

**Evidence:**

- Message creation routes check the `Block` relationship.
- Agreement and swap visibility routes check the `Block` relationship.
- `GET /api/messages/thread` returns messages between two users without checking whether either user blocked the other.

**Risk:** A user who believes they blocked a harasser may still see or expose an active conversation through the thread endpoint. This is inconsistent with the current blocking behavior elsewhere.

**Required decision and fix:**

- Preferred safety behavior: return an empty result or `403`/`404` for blocked conversation reads, and prevent read-state updates.
- If conversation history must remain available for abuse evidence, document that policy in the UI and privacy documentation, provide an abuse-report path, and add tests proving exactly what each participant can still access.

**Acceptance evidence:**

- Tests cover block in both directions.
- Tests cover thread GET, thread DELETE, mark-read, direct messages, swap messages, interests, agreements, and swap visibility.
- UI copy accurately describes what blocking does.

### B3. Obtain a complete database-backed and Redis-backed test pass

**Severity:** Release gate blocker

**Evidence:** The local run produced a passing pure-test subset but skipped critical infrastructure-dependent tests. The earlier full run reported `36 passed, 22 skipped`; DB and Redis scenarios were not proven locally.

Critical skipped areas include:

- Concurrent agreement/state transitions.
- Duplicate proposal conflict paths.
- Notification delivery targeting.
- Redis rotation grace and token reuse behavior.
- Swap teaser and ICS authorization paths.
- Attribution and growth flows.
- Metrics behavior.

**Required fix:** Run the same setup used by CI against a disposable PostgreSQL database and a disposable Redis instance. Do not accept skipped critical tests as passing.

**Acceptance evidence:**

- `npm ci` completes from the lockfile.
- `npx prisma generate` completes.
- Database schema is created using the documented CI/production-compatible path.
- Partial unique indexes are present.
- Redis-backed tests execute, or their required Redis test service is added to CI.
- `npm test` finishes with zero failures and no unapproved skips.
- CI fails if required DB/Redis tests are skipped.

### B4. Triage and remediate production dependency vulnerabilities

**Severity:** High security/release risk

**Evidence:** `npm audit --omit=dev` reported high-severity transitive findings involving packages including `brace-expansion`, `browserslist`, `fast-uri`, `hono`, and related Prisma/Sentry dependency chains.

**Required fix:**

1. Re-run the audit from a clean checkout with the lockfile.
2. Identify whether each finding is reachable in production runtime or build tooling.
3. Upgrade direct dependencies and regenerate the lockfile where safe.
4. For findings requiring a breaking upgrade, document the decision and mitigation.
5. Do not use `npm audit fix --force` blindly because it may change Prisma or Next.js major versions.

**Acceptance evidence:**

- Audit output is attached to the release record.
- No unresolved critical findings remain.
- Every unresolved high finding has a documented owner, exploitability assessment, and approved mitigation.
- Production build and test suite pass after dependency changes.

## Required Before Launch: Infrastructure Proof

These are not provable from source code alone and must be checked in the actual staging or production accounts.

### Deployment and database

- Create and use a real staging environment with a separate Neon branch/database.
- Confirm Vercel Preview variables point to staging, not production.
- Rehearse `prisma migrate deploy` from a clean database.
- Rehearse the migration path against a copy/branch of production schema.
- Confirm the partial indexes required by agreement conflict handling exist after deployment.
- Confirm production and preview use compatible Prisma client/runtime versions.
- Confirm database connection limits, pooling, and timeouts under expected traffic.
- Confirm backups and point-in-time restore are enabled and a restore has been rehearsed.
- Confirm no test or seed data is present in production.

### Required production environment variables

Verify presence, scope, format, and rotation ownership for:

- `DATABASE_URL`
- `JWT_SECRET`
- `JWT_REFRESH_SECRET`
- `JWT_RESET_SECRET`
- `NEXT_PUBLIC_APP_URL`
- `RESEND_API_KEY`
- `EMAIL_FROM`
- `CRON_SECRET`
- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_EMAIL`
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`
- `SENTRY_DSN` or `NEXT_PUBLIC_SENTRY_DSN`, as applicable
- `SENTRY_ORG`, `SENTRY_PROJECT`, and `SENTRY_AUTH_TOKEN` for build integration
- `HEARTBEAT_URL_BASE`, if cron dead-man monitoring is being used
- `REPORTS_ALERT_EMAIL`, if abuse-report email alerts are required

Never place server secrets under a `NEXT_PUBLIC_` name. Verify values without printing them.

### Redis and rate limiting

- Confirm rate limits work with production Redis.
- Confirm behavior when Redis is unavailable is intentional and monitored.
- Confirm token blocklisting and rotation grace behavior.
- Configure an alert when the rate limiter falls back or Redis health fails.
- Confirm health checks produce the desired paging behavior.

### Email

Test all of these in staging with real deliverability checks:

- Email verification.
- Password reset.
- Resend verification.
- Swap interest notification.
- New message notification.
- Admin abuse-report alert.
- Daily digest.
- Agreement follow-up.

Verify SPF, DKIM, DMARC, sender identity, reply-to behavior, bounce handling, and links generated with the production app URL.

### Cron jobs

Confirm Vercel has registered and executed each cron with the correct `CRON_SECRET`:

- Expire swaps.
- Expiring-soon notifications.
- Daily digest.
- Cleanup/archive.
- Expire announcements.
- Agreement follow-ups.

Verify New York calendar-date behavior across both EST and EDT. Confirm heartbeat monitors alert when a cron does not run and do not alert on expected preview/dev behavior.

### Sentry and analytics privacy

- Confirm replay masking is enabled in the deployed client bundle.
- Confirm passwords, message text, swap details, and contact fields are not visible in replay or event context.
- Confirm server-side Sentry data scrubbing is configured.
- Review all Google Analytics/GTM tags and triggers.
- Update the Privacy Policy with Sentry, Google Analytics/GTM, Resend, retention, and deletion behavior.
- Provide an analytics opt-out or document the approved legal/privacy basis.

## Required Product and Safety Checks

### User identity and affiliation

- Add and visibly display the non-affiliation statement:
  `We Move NY is not affiliated with, endorsed by, or operated by TWU Local 100 or the MTA.`
- Confirm it appears before or during account creation and is present in the relevant legal/privacy content.
- Confirm support and abuse-report contact information is visible to users.

### Abuse and moderation

- Verify the report flow creates an admin-visible queue item.
- Verify report alerts reach a monitored mailbox.
- Assign an on-call owner and response-time target for abuse reports.
- Test suspension and account deletion against active sessions.
- Test blocked-user behavior across every read and write path.
- Decide whether poster names are visible to all depot members and document that choice.
- Review whether swap details can expose sensitive work schedules or personal information.

### Core workflow acceptance tests

Run these with at least two normal users, an admin, a suspended user, an unverified user, and users from different depots:

- Register, verify email, accept terms, log in, refresh, and log out.
- Failed-login lockout and password reset.
- Post a normal swap.
- Reject invalid dates, malformed dates, dates too far in the future, and invalid contact data.
- Edit a swap and repeat all date validations.
- Propose, accept, decline, cancel, confirm, report no-show, and dispute an agreement.
- Race duplicate proposals and concurrent state transitions.
- Verify only the correct participants can view agreements, calendars, messages, and archived swaps.
- Verify cross-depot access is rejected.
- Verify deletion/anonymization, export, notifications, and saved swaps.
- Verify admin and sub-admin boundaries, including email visibility and destructive actions.

## Mobile, Browser, and Accessibility Checks

- Test current Chrome, Safari, Firefox, and Edge.
- Test iPhone Safari, including add-to-home-screen behavior.
- Test iOS 16.4+ push permission from an installed PWA.
- Test Android install prompt and push behavior.
- Test slow network, offline shell, reconnect, expired access token, and failed refresh.
- Confirm no layout overflow in shift forms, date fields, messages, and admin tables.
- Run keyboard-only navigation.
- Verify focus indicators, labels, error messages, color contrast, and screen-reader names.
- Verify destructive actions require confirmation and cannot be double-submitted.

## Operational Readiness

Before launch, Haron should have named owners for:

- Production deploy approval.
- Database migrations and restore.
- Authentication/session incidents.
- Redis/rate-limit incidents.
- Email deliverability.
- Abuse reports and user safety.
- Sentry errors and uptime alerts.
- Vercel cron failures.

The existing runbook documents basic Vercel rollback, maintenance mode, and database rollback concepts, but the procedure still needs a live rehearsal with the actual accounts and credentials held by the project owner.

## Historical Findings Already Addressed

The older `PRELAUNCH_AUDIT.md` and `AUDIT_ACTION_PLAN.md` contain findings that no longer accurately describe the current code. Do not re-open these as current blockers without regression evidence:

- Agreement proposal `P2002` handling is now present.
- Outbound message email content uses HTML escaping.
- A `Block` model and several block checks are now present.
- Sentry replay masking is now configured.
- Swap edit date validation is now present.
- CSP includes `form-action 'self'`.
- User export has a rate limit.
- Apple touch icon metadata is present.
- Expire-swaps cron is scheduled at `0 5 * * *`.
- Rollback procedures are now documented in `RUNBOOK.md`.

These fixes still require regression tests and deployment verification where noted above.

## Release Gate

Haron should not approve public launch until every item below is checked and evidenced:

- [ ] B1 global logout/token revocation fixed and tested for cookie and bearer paths.
- [ ] B2 blocking policy decided, implemented, documented, and tested for reads and writes.
- [ ] B3 DB/Redis-backed tests run with no critical skips.
- [ ] B4 dependency audit triaged and approved.
- [ ] Production build completes successfully from a clean checkout.
- [ ] Staging deployment is isolated from production data.
- [ ] Production migrations rehearsed on a database branch.
- [ ] Required production environment variables verified without exposing values.
- [ ] Email delivery and authentication flows verified.
- [ ] Redis, token revocation, rate-limit alerts, and health checks verified.
- [ ] All cron jobs verified with dead-man monitoring.
- [ ] Sentry replay/data scrubbing verified in the deployed bundle.
- [ ] Privacy Policy, Terms, analytics disclosure, and non-affiliation notice reviewed.
- [ ] Abuse-report queue has a monitored owner.
- [ ] Mobile PWA, push, browser, accessibility, and offline checks completed.
- [ ] Rollback and database restore rehearsed.
- [ ] Haron signs off on the remaining accepted risks.

**Final status:** Until all Critical/High items are closed and the evidence checklist is complete, the correct launch status is **NOT READY**.
