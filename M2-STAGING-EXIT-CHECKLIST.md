# Habitt: M2 Staging Exit Checklist

**Status:** NOT RUN. Scheduled for after M8 (launch readiness), against a real staging deployment.
**Put this file at:** `docs/M2-STAGING-EXIT-CHECKLIST.md` in the repo.

How to use: tick `[x]` when an item passes. If it fails, write what happened in the Notes column, fix it, and re-test. Mark items `BLOCKED` (not failed) when an account or key is missing.

**Exit rule:** every item in A to F passes. Items 17 and 20 matter most because they prove fail-closed behaviour and no secrets in logs on real infrastructure.

Run date: ____________  Tester: ____________  Commit tested: ____________

---

## A. Setup

| # | Done | Check | Notes |
|---|------|-------|-------|
| 1 | [ ] | Staging env vars set: `DATABASE_URL` (transaction pooler, port 6543, `?pgbouncer=true&connection_limit=1`), `DIRECT_URL` (5432), `AUTH_SECRET`, `OTP_PEPPER`, `CRON_SECRET`, `UPSTASH_REDIS_REST_URL` / `_TOKEN`, `RESEND_API_KEY`, real Turnstile keys (NOT Cloudflare's always-pass test keys), `OWNER_EMAIL`, Razorpay TEST keys, `META_GRAPH_VERSION` (check the Meta changelog; v20.0 is probably stale) | |
| 2 | [ ] | `WHATSAPP_OTP_LIVE=false`; `REVIEWER_OTP_ENABLED` is not `true` and the other `REVIEWER_*` vars are unset | |
| 3 | [ ] | `npx --no-install prisma migrate deploy` against the staging DB (8 migrations expected by then or more), then the seed. Owner + allowlist row created from `OWNER_EMAIL` | |
| 4 | [ ] | CI (`.github/workflows/ci.yml`) is green: Node 22, unit tests, build. Note: CI has no integration tests and no Postgres service | |

## B. Staff and owner

| # | Done | Check | Notes |
|---|------|-------|-------|
| 5 | [ ] | `/staff/login` as the owner with a real email OTP works | |
| 6 | [ ] | A non-allowlisted email gets the identical neutral response and no email arrives | |
| 7 | [ ] | `/admin/team`: add and remove an allowlisted email (step-up required). Self-removal and removing the last owner are blocked | |
| 8 | [ ] | A logged-in customer is blocked from `/admin` | |
| 9 | [ ] | New-device alert email arrives on the first staff login from a new browser, and not on the second login from the same browser | |

## C. Customers

| # | Done | Check | Notes |
|---|------|-------|-------|
| 10 | [ ] | Email OTP login works with the real Resend setup (delivers only to your own address until the domain is verified) | |
| 11 | [ ] | 5 wrong codes lock that code; a fresh request works. The 4th OTP send to the same email inside the window is blocked | |
| 12 | [ ] | Contact change gives the same neutral message whether the new email/phone is registered or free; the alert goes to the OLD email and contains no values | |
| 13 | [ ] | Sign out everywhere: log in on two browsers, sign out everywhere from one, the other fails on its next protected action | |
| 14 | [ ] | Phone login, phone step-up and phone contact change all show "Phone verification isn't available yet. Please use your email." No OTP rows are created and no codes appear in Vercel logs | |

## D. Cart and address

| # | Done | Check | Notes |
|---|------|-------|-------|
| 15 | [ ] | Cart added on browser A appears after login on browser B. Logout clears it. Logging in as a different user on the same browser clears the old cart and loads that user's cart | |
| 16 | [ ] | Address book: first address is default, max 10, only one default | |

## E. Hardening

| # | Done | Check | Notes |
|---|------|-------|-------|
| 17 | [ ] | With Upstash configured, rate limits are enforced. With the Upstash env temporarily removed on staging, OTP and login fail closed with the "temporarily unavailable" message and nothing is sent | |
| 18 | [ ] | Cron routes return 401 without `CRON_SECRET` and run with it | |
| 19 | [ ] | `/signup` redirects; security headers present (CSP is still report-only at this stage); `/api/health` returns 200 | |
| 20 | [ ] | Search the Vercel logs for OTP codes: there must be none | |
| 21 | [ ] | With the reviewer env disabled, reviewer login behaves exactly like a wrong code | |

## F. Watch items carried over from development

| # | Done | Check | Notes |
|---|------|-------|-------|
| 22 | [ ] | `syncCartAction` under concurrent calls on staging: no "Unable to start a transaction" errors (`cart.ts` `$transaction` now has `maxWait: 10000`, `timeout: 20000`; the same bump is still owed for the verify and webhook transactions in M8) | |
| 23 | [ ] | Vercel function duration and cron limits fit the chosen plan (`vercel.json` crons */30, hourly, daily probably exceed Hobby; use Pro or an external scheduler calling the cron routes with `CRON_SECRET`) | |
| 24 | [ ] | Production has `WHATSAPP_OTP_LIVE` unset or false until Meta business verification and the OTP template are approved, then a real +91 test passes before it is set to `true` | |

---

## Known state at the time this file was written

- Integration suite: 38 files, 105 tests, passed locally. Unit suite: 20 files, 90 tests.
- Phone OTP is gated behind `WHATSAPP_OTP_LIVE` for production (step-up, login, contact change). Dev and test still use the console fallback.
- The T62 cart concurrency test failed intermittently on the dev machine before the transaction options were raised.
- Dev DB `codRequiresDeliveredOrder` was `false` (schema default is `true`); set it deliberately for staging.
