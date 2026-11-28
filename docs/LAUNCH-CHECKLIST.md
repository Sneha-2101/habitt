# Production Launch Checklist

## 1. Production Environment Variables

> **Never commit secrets or `.env` files.** Configure all values in your hosting provider (e.g. Vercel Project Settings → Environment Variables).

| Name | Used In | Required | Purpose |
| --- | --- | --- | --- |
| `NODE_ENV` | `app/`, `lib/` | Required (`production`) | Enables production security checks (fail-closed Turnstile, Redis rate limits, cookie security, indexing rules). |
| `DATABASE_URL` | `lib/prisma.ts`, `scripts/break-glass-owner.mjs` | Required | Pooled PostgreSQL connection string used by Prisma Client at runtime. |
| `DIRECT_URL` | `prisma/schema.prisma`, `scripts/break-glass-owner.mjs` | Required | Direct PostgreSQL connection string used for `prisma migrate deploy` and break-glass CLI. |
| `AUTH_SECRET` | `lib/otp.ts`, `lib/otp-identifier.ts` | Required | NextAuth / OTP HMAC secret (must be strong random secret in production). |
| `OTP_PEPPER` | `lib/otp.ts`, `lib/otp-identifier.ts` | Required in prod | Dedicated pepper for hashing OTP codes and identifiers. |
| `OTP_DAILY_CAP` | `lib/ratelimit.ts` | Optional (default `300`) | Global daily OTP send cap per UTC day. |
| `NEXTAUTH_URL` | `lib/email.ts`, `lib/seo/site-url.ts` | Recommended | Canonical base URL for auth callbacks and fallback site URL. |
| `NEXT_PUBLIC_SITE_URL` | `lib/email.ts`, `lib/seo/site-url.ts` | Required | Public canonical site URL used in emails, sitemaps, feeds, and canonical tags. |
| `CRON_SECRET` | `app/api/cron/*` | Required | Bearer token authenticating scheduled cron requests (`Authorization: Bearer <CRON_SECRET>`). |
| `NEXT_PUBLIC_RAZORPAY_KEY_ID` | `app/checkout/page.tsx` | Required | Public Razorpay key ID for checkout widget. |
| `RAZORPAY_KEY_ID` | `lib/razorpay.ts` | Required | Server-side Razorpay API key ID. |
| `RAZORPAY_KEY_SECRET` | `app/api/checkout/verify/route.ts`, `lib/razorpay.ts` | Required | Server-side Razorpay API secret and payment signature verification key. |
| `RAZORPAY_WEBHOOK_SECRET` | `app/api/webhooks/razorpay/route.ts` | Required | Secret for verifying Razorpay webhook signatures. |
| `NEXT_PUBLIC_SUPABASE_URL` | `lib/supabase.ts`, `lib/actions/content.ts` | Required | Public Supabase project URL for storage/public asset URLs. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `lib/supabase.ts` | Optional/Recommended | Supabase publishable/anon key. |
| `SUPABASE_URL` | `lib/supabase.ts` | Required | Server-side Supabase URL for admin storage operations. |
| `SUPABASE_SERVICE_ROLE_KEY` | `lib/supabase.ts` | Required | Server-side Supabase service role key for product/banner/OG image uploads. |
| `RESEND_API_KEY` | `lib/email.ts`, `lib/otp-email.ts` | Required | Resend API key for transactional emails and email OTPs. |
| `RESEND_FROM_EMAIL` | `lib/email.ts`, `lib/otp-email.ts` | Recommended | Verified sender email address (falls back to `SiteSettings` or Resend sandbox if unset). |
| `UPSTASH_REDIS_REST_URL` | `lib/ratelimit.ts` | Required in prod | Upstash Redis REST URL for distributed rate limiting & OTP daily cap. |
| `UPSTASH_REDIS_REST_TOKEN` | `lib/ratelimit.ts` | Required in prod | Upstash Redis REST token. |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | `app/contact/*`, `app/login/*`, `app/staff/login/page.tsx` | Required in prod | Cloudflare Turnstile public site key. |
| `TURNSTILE_SECRET_KEY` | `lib/turnstile.ts` | Required in prod | Cloudflare Turnstile secret key (fails closed in production if missing). |
| `SHIPROCKET_ENABLED` | `app/api/webhooks/shiprocket/route.ts`, `lib/shipping/shiprocket.ts` | Optional (`true` when active) | Enables Shiprocket shipping integration. |
| `SHIPROCKET_EMAIL` | `lib/shipping/shiprocket.ts` | Optional (if enabled) | Shiprocket API account email. |
| `SHIPROCKET_PASSWORD` | `lib/shipping/shiprocket.ts` | Optional (if enabled) | Shiprocket API account password. |
| `SHIPROCKET_WEBHOOK_TOKEN` | `app/api/webhooks/shiprocket/route.ts`, `lib/shipping/shiprocket.ts` | Optional (if enabled) | Shared token to authenticate incoming Shiprocket webhooks. |
| `WHATSAPP_OTP_LIVE` | `lib/whatsapp-flag.ts` | Optional (keep **unset** until Meta ready) | Enables live WhatsApp OTP delivery. |
| `WHATSAPP_MESSAGES_LIVE` | `lib/whatsapp-flag.ts` | Optional (keep **unset** until Meta ready) | Enables live WhatsApp outbox notifications. |
| `META_WHATSAPP_PHONE_NUMBER_ID` | `lib/whatsapp.ts` | Optional (if live) | Meta Cloud API phone number ID. |
| `META_WHATSAPP_TOKEN` | `lib/whatsapp.ts` | Optional (if live) | Meta Cloud API bearer token. |
| `META_GRAPH_VERSION` | `lib/whatsapp.ts` | Optional (default `v20.0`) | Meta Graph API version. |
| `SUPPORT_EMAIL` | `lib/actions/tickets.ts`, `lib/actions/guest-tickets.ts`, `lib/tickets/sla.ts` | Optional | Fallback support/alert email when `SiteSettings` field is unset. |
| `VERCEL_ENV` | `app/layout.tsx`, `app/robots.ts`, `app/feed/google/route.ts`, `lib/seo/metadata.ts` | Platform-managed | Distinguishes `production` vs `preview` deployments for SEO indexing. |
| `NEXT_PHASE` | `lib/build-safe.ts`, `lib/prisma.ts` | Platform-managed | Set by Next.js during `next build` to avoid live DB queries at build time. |
| `NEXT_PUBLIC_META_PIXEL_ID` | `components/MetaPixel.tsx` | Optional | Meta Pixel ID for consented storefront analytics. |

### Variables That Must NEVER Be Set in Production Defaults
- `REVIEWER_OTP_ENABLED` — must remain **unset** (or `false`) in production defaults.
- `REVIEWER_IDENTIFIER`, `REVIEWER_OTP_CODE`, `REVIEWER_OTP_EXPIRES_AT` — must remain **unset** outside temporary review windows.
- `NODE_ENV` must be `production`.

---

## 2. Cron Schedule Table

All cron endpoints require `GET` with header `Authorization: Bearer <CRON_SECRET>`.

| Route | Recommended Frequency | Current `vercel.json` | Purpose |
| --- | --- | --- | --- |
| `/api/cron/outbox` | Every 1 minute | Not in `vercel.json` | Processes `EventOutbox` batches (`EMAIL`, `WHATSAPP`, and `INTERNAL` jobs such as `LATE_CAPTURE_REFUND`). |
| `/api/cron/close-stale-orders` | Every 15–30 minutes | `*/30 * * * *` | Closes unpaid `PENDING` Razorpay orders older than 2 hours and runs `recoverInterruptedRefunds()`. |
| `/api/cron/abandoned-cart` | Hourly | `0 * * * *` | Sends abandoned-cart reminder emails. |
| `/api/cron/birthday-discount` | Daily | `30 3 * * *` | Generates and emails birthday discount coupons. |
| `/api/cron/wallet-expiry` | Daily | Not in `vercel.json` | Expires wallet lots past `expiresAt` and enqueues 7-day `WALLET_EXPIRY_WARNING` emails. |
| `/api/cron/rewards` | Daily | Not in `vercel.json` | Releases loyalty accruals, referrer rewards, pending referee credits, and expires stale referrals. |
| `/api/cron/shipment-sync` | Every 2–6 hours | Not in `vercel.json` | Polls Shiprocket tracking status for in-transit shipments. |
| `/api/cron/ticket-sla` | Every 15–60 minutes | Not in `vercel.json` | Checks support ticket SLA breaches and sends alert emails. |

> **Hosting Note:** Vercel Hobby plans only allow **daily** cron jobs in `vercel.json`. For sub-daily schedules (`/api/cron/outbox`, `/api/cron/close-stale-orders`, etc.), either use Vercel Pro or an external scheduler (e.g. GitHub Actions / cron-job.org / Upstash QStash) sending `Authorization: Bearer $CRON_SECRET`.

---

## 3. DNS & Email (Resend)

- Add and verify your sending domain in **Resend** (SPF, DKIM, and DMARC DNS records).
- Set `RESEND_FROM_EMAIL` (and `ordersEmail` / `replyToEmail` in Admin Settings) to an address on the verified domain.
- Confirm `RESEND_API_KEY` is a production key (not `"disabled"`).

---

## 4. Provider Feature Switches

- Keep `WHATSAPP_OTP_LIVE` and `WHATSAPP_MESSAGES_LIVE` **unset** until Meta WhatsApp Business verification, templates, and credentials (`META_WHATSAPP_PHONE_NUMBER_ID`, `META_WHATSAPP_TOKEN`) are ready.
- Keep `SHIPROCKET_ENABLED` unset/`false` until Shiprocket credentials and pickup location are configured.

---

## 5. First-Owner Setup & Break-Glass Recovery

- Ensure the initial `OWNER` user and active `StaffAllowlist` row exist in the production database.
- For emergency owner recovery or rotation (lost/compromised owner account), use the CLI-only break-glass tool documented in [`docs/BREAK-GLASS.md`](file:///c:/Users/admin/Desktop/habitt/docs/BREAK-GLASS.md) (`scripts/break-glass-owner.mjs`).

---

## 6. Post-Deploy Smoke-Test Checklist

1. `GET /api/health` returns `200 { "ok": true }`.
2. Storefront `/` and `/shop` load; `/product/[slug]` renders and `AddToCart` updates cart.
3. Customer login OTP flow (email) succeeds and creates a session.
4. Staff login at `/staff/login` succeeds for the `OWNER` account; `/admin/reports` loads all tabs including Gross Margin.
5. Checkout quote + Razorpay test/live order creation and webhook signature verification succeed.
6. `GET /api/cron/outbox` and `GET /api/cron/close-stale-orders` with `Authorization: Bearer <CRON_SECRET>` return `200`.
7. `/robots.txt`, `/sitemap.xml`, and `/feed/google` behave as expected for `seoIndexingEnabled`.

## To Confirm

- Confirm `NEXT_PUBLIC_META_PIXEL_ID` if Meta Pixel tracking will be enabled at launch.
- Confirm external cron scheduler setup for `/api/cron/outbox` (1 min) and `/api/cron/wallet-expiry` / `/api/cron/rewards` / `/api/cron/shipment-sync` / `/api/cron/ticket-sla` if on Vercel Hobby.
