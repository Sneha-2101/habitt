# TechSpec — Habitt

## Stack
- **Frontend:** Next.js 15 (App Router), TypeScript, Tailwind CSS. Server Components for catalog pages (SEO, speed); Client Components for cart, checkout, sheets and admin forms. Keep Next.js on the latest patched 15.x (the middleware authorization-bypass advisory was fixed in 15.2.3; never run below it).
- **Backend:** Next.js Route Handlers and Server Actions; scheduled work as secret-protected route handlers triggered by Vercel Cron.
- **Database:** PostgreSQL on Supabase via **Prisma 5**. Schema changes use **Prisma migrations** (`migrate dev` locally, `migrate deploy` in release). `db push` is retired in M1.
- **Storage:** Supabase Storage. Public bucket for product media; private bucket for invoices and return photos (signed URLs). Uploads go **directly from the browser** to storage with signed upload URLs (serverless request bodies are limited — confirm Vercel's current limit — so photos must not pass through server actions). Images are compressed in the browser before upload.
- **Auth:** Auth.js (NextAuth v5) with a Credentials provider that verifies an OTP challenge; JWT sessions carrying a session id checked against the `Session` table. No passwords.
- **Payments:** Razorpay Orders API, Checkout.js, webhooks, refunds API. COD handled in-house.
- **Shipping:** Shiprocket API (serviceability, order/shipment creation, AWB, labels, tracking webhooks, pickup for returns).
- **Messaging:** WhatsApp Cloud API (Meta) called directly; Resend for email. Both sit behind one `messaging` module.
- **Rate limiting:** Upstash Redis (`@upstash/ratelimit`) — shared across serverless instances. In-memory limiting is allowed only in local development.
- **Bot protection:** Cloudflare Turnstile on OTP send, contact and referral/gift-card lookup endpoints.
- **Observability:** Sentry (errors and performance), structured logs with no PII, uptime monitor on `/api/health`.
- **Hosting:** Vercel (paid plan for commercial use) and Supabase (paid plan for backups and no idle pausing) in the Mumbai region where available. Domain and accounts are owned by the business.
- **Testing:** Vitest (unit), Playwright (end-to-end), Lighthouse CI (budgets).

## Code organisation (`lib/` modules)
Each module has one job and is imported by routes and actions rather than duplicating logic.
```
lib/auth/        session, requireUser, requireRole, requireStepUp, safeRedirect
lib/otp/         challenge create/verify, hashing, rate limits, providers (whatsapp, email, console)
lib/settings/    typed registry (zod schema + default per key), cached reads, audit-logged writes
lib/pricing/     priceCart() — the pure pricing engine (offers, coupon, prepaid, shipping, COD fee, wallet)
lib/gst/         rule lookup, per-line tax, place of supply, invoice numbering, invoice PDF
lib/orders/      createOrder, markOrderPaid, cancelOrder, transitions, stock movements
lib/payments/    razorpay client, signature checks, refunds, webhook handling
lib/shipping/    shiprocket client, serviceability, shipment sync, shipping fee calculation
lib/messaging/   sendMessage(templateKey, to, vars), consent + frequency checks, MessageLog
lib/wallet/      credit, debit (earliest-expiry first), expiry, gift cards, referral and loyalty release
lib/analytics/   consent-aware first-party events, attribution capture, Meta CAPI outbox, feeds
lib/seo/         metadata helpers, JSON-LD builders, sitemap/robots helpers
lib/audit/       writeAudit(actor, action, entity, before, after)
lib/ratelimit/   Upstash wrapper with policy names
```
Money helpers (`toPaise`, `formatINR`, `allocate`) live in `lib/money.ts` and are the only place that does rounding.

## Environment variables
```
# Core
DATABASE_URL=  DIRECT_URL=  NEXT_PUBLIC_SITE_URL=
AUTH_SECRET=                 # required; app must refuse to start without it (no fallback)
CRON_SECRET=
OTP_PEPPER=                  # HMAC key for OTP and identifier hashes
# Supabase
SUPABASE_URL=  SUPABASE_SERVICE_ROLE_KEY=  NEXT_PUBLIC_SUPABASE_URL=  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
# Payments
RAZORPAY_KEY_ID=  RAZORPAY_KEY_SECRET=  RAZORPAY_WEBHOOK_SECRET=  NEXT_PUBLIC_RAZORPAY_KEY_ID=
# Messaging
RESEND_API_KEY=  EMAIL_FROM=
WHATSAPP_PHONE_NUMBER_ID=  WHATSAPP_ACCESS_TOKEN=  WHATSAPP_APP_SECRET=  WHATSAPP_VERIFY_TOKEN=
OTP_PROVIDER=console|live   # console logs codes in dev/staging
REVIEWER_OTP_ENABLED=false  # temporary fixed-code account for Razorpay's website review; off in prod after approval
# Shipping
SHIPROCKET_EMAIL=  SHIPROCKET_PASSWORD=  SHIPROCKET_WEBHOOK_TOKEN=
# Protection
UPSTASH_REDIS_REST_URL=  UPSTASH_REDIS_REST_TOKEN=
NEXT_PUBLIC_TURNSTILE_SITE_KEY=  TURNSTILE_SECRET_KEY=
# Observability and marketing
SENTRY_DSN=  NEXT_PUBLIC_SENTRY_DSN=
NEXT_PUBLIC_META_PIXEL_ID=  META_CAPI_TOKEN=  NEXT_PUBLIC_GA4_ID=
VAPID_PUBLIC_KEY=  VAPID_PRIVATE_KEY=   # web push for the admin PWA
OWNER_EMAIL=                 # seeds the first OWNER account
```
Secrets exist only in Vercel/Supabase environment settings, never in the repo. Test and live Razorpay keys are separate per environment.

## Authentication and sessions

### OTP challenges
- 6-digit numeric codes from a CSPRNG. Stored as `HMAC(OTP_PEPPER, code + challengeId)`; the identifier is stored as `HMAC(OTP_PEPPER, normalizedIdentifier)`. Raw codes and identifiers are never persisted or logged.
- Expiry 10 minutes, single use, **5 verification attempts** per challenge, constant-time comparison. A new send invalidates earlier open challenges for that identifier.
- Send limits: 30-second cooldown, 3 sends per 15 minutes per identifier, 10 per hour per IP, plus a daily global cap with an alert (guards against SMS/WhatsApp pumping). Turnstile is required before every send.
- Responses are neutral: sending to an unknown email or phone looks identical to a known one.
- **Channels:** WhatsApp **Authentication-category** template with the copy-code button (cheapest and approved fastest); email via Resend. If WhatsApp fails or the number is not on WhatsApp, the UI offers email. Channel selection is behind `flags.whatsappOtp`; until Meta business verification completes, only email works.
- `OTP_PROVIDER=console` prints codes to server logs for development and staging. `REVIEWER_OTP_ENABLED` creates one fixed-code reviewer account for Razorpay's website review (login is required to pay); it must be disabled in production after approval.

### Sessions
- On successful verification a `Session` row is created and a signed Auth.js JWT is issued carrying `sid`, `uid`, `role`. Cookie: `HttpOnly; Secure; SameSite=Lax`, long max-age (browsers cap cookie lifetime at roughly 400 days, so "never log out" means a sliding ~1 year renewed on use).
- **Customers:** sliding expiry (~365 days), `lastSeenAt` updated at most once per day. Manual sign-out, and "sign out of all devices" revokes every `Session` row.
- **Staff/owner:** 7-day sliding, 30-day absolute. New-device sign-in emails the owner.
- Middleware (edge) can only read the JWT; it does **coarse** routing only. Real authorization is server-side: `requireUser()`, `requireRole(...roles)` and `requireStepUp(maxAgeMinutes)` are called inside every server action and route handler. They verify the `Session` row (not revoked, not expired) at checkout, account, and every admin action.
- **Step-up:** a fresh OTP stamps `stepUpAt` on the session; sensitive actions require it within 10 minutes.
- `safeRedirect(next)` accepts only same-origin relative paths starting with a single `/`.

### Permission matrix (default, owner-adjustable later)
| Capability | OWNER | STAFF |
|---|---|---|
| Orders: view, confirm, pack, ship, cancel, notes | ✓ | ✓ |
| Refunds, wallet adjustments | ✓ (step-up) | — |
| Products, collections, stock | ✓ | ✓ |
| Prices and cost price | ✓ | price ✓, cost price — |
| Offers and coupons | ✓ | view only |
| Content and pages | ✓ | ✓ |
| Settings (GST, shipping, COD, payments, flags) | ✓ (step-up) | — |
| Revenue, profit and exports | ✓ (step-up for export) | — (order-level only) |
| Staff and roles, audit log | ✓ | — |

## Pricing engine (`lib/pricing`)
A pure, deterministic function used by the cart preview endpoint and by order creation:
```ts
priceCart(input: {
  lines: { variantId: string; qty: number }[];
  couponCode?: string;
  paymentMethod: "PREPAID" | "COD";
  shippingAddress?: { state: string; pincode: string };
  walletRequestedPaise?: number;
  userId?: string;
  now: Date;
}, ctx: { catalog; offers; settings; wallet; usage }): PricedCart
```
- All values are integers in paise. Order of evaluation is exactly the nine steps in `AppFlow.md`.
- Offer rules are zod-validated JSON per `OfferType`; unknown or invalid configs are skipped and logged, never thrown at the customer.
- Discount allocation across lines uses **largest-remainder rounding**, so line allocations sum to the discount exactly.
- The output includes per-line `{ unitPrice, discountAllocated, taxableValue, gstRateBp, taxAmount }`, a list of applied and rejected offers with reasons (shown to the customer), totals, and warnings (stock, expired offer).
- The cart preview endpoint and `create-order` call the same function; the client never sends prices or totals.
- Unit tests use golden cases: combo + automatic % + prepaid; coupon vs automatic comparison; free shipping at the threshold; cap and cost-floor trimming; rounding with odd amounts; wallet partially covering the total; zero-total edge case.

## GST and invoices (`lib/gst`)
- Catalog prices are GST-inclusive. Tax is extracted per line from the **discounted** price.
- `GstRule` rows hold HSN prefix, the per-piece pre-tax threshold, the low and high rates, and an effective date, so the CA can change them without code. The seeded default for apparel follows the current slab: a lower rate up to the threshold per piece and a higher rate above it. **Confirm the exact rates, threshold and bundle-allocation method with the CA before launch.**
- Place of supply: seller state (`store.stateCode`) versus shipping state decides CGST+SGST versus IGST.
- Shipping and COD fees are taxed only if the corresponding settings say so (CA decision).
- Invoice number: allocated from `InvoiceCounter` for the financial year inside the same transaction that marks the order paid (prepaid) or confirmed (COD), so numbers are gapless and unique. Credit notes use their own series.
- `gst.enabled = false` produces a plain **order receipt** (`InvoiceKind.RECEIPT`) and the store must not take real orders in that state.
- PDF generation is server-side with a pure-JS library (no headless browser); files are stored in the private bucket and served by short-lived signed URLs.

## Orders, payments and stock (`lib/orders`, `lib/payments`)
- **State machines** are in `Schema.md`. All transitions go through `lib/orders/transitions.ts`, which rejects illegal moves; admin screens only offer legal next steps.
- **Idempotency:** the client sends `idempotencyKey` (UUID per checkout attempt). `create-order` looks the key up first. The unique constraint protects against races. If a pending order's amount is unchanged on retry, the existing Razorpay order is reused; if it changed, a new Razorpay order is created and the old one is no longer accepted.
- **Validation:** zod schema — 1–20 lines, integer qty 1–10, duplicate variants merged *before* the stock check, only `ACTIVE` products, variant must belong to the product.
- **`markOrderPaid(tx, orderId, paymentId)`** (the only function that sets prepaid orders to paid) in one transaction: conditional update (`WHERE paymentStatus <> 'PAID'`), guarded stock decrement, `StockMovement` rows, invoice number, wallet debit, referral/influencer attribution rows, outbox entries for messages and server-side ad events. If a guarded decrement fails (stock sold out between cart and payment), the order is still marked paid because the money is captured; stock is clamped at 0, an `OVERSOLD` movement is written, an error is logged and the admin inbox shows it for manual resolution (refund or restock).
- **Guarded decrement** (also protected by a database `CHECK (stock >= 0)`):
```sql
UPDATE "ProductVariant" SET stock = stock - $qty WHERE id = $id AND stock >= $qty;
-- affected rows = 0  → insufficient stock
```
- **Webhooks:** verify the raw-body HMAC; insert the provider event id (Razorpay sends an event-id header — confirm the exact name in Razorpay's docs) into `ProcessedWebhook` first and return 200 on duplicates. Handle `payment.captured`, `payment.failed`, `refund.processed`.
- **COD:** `create-order` with `paymentMethod = COD` skips Razorpay, decrements stock at placement, sets `COD_PENDING` and `PLACED`, and checks eligibility server-side (enabled, within max value, serviceable pincode, not `codBlocked`, pending-COD cap).
- **Refunds:** to source via Razorpay refunds API (amount ≤ captured minus refunded) or to the wallet as a `REFUND_CREDIT` entry (optionally with a bonus). Both create a `Refund` row and a credit note when GST is enabled.
- **Cleanup job:** `PENDING` prepaid orders older than a configurable window (default 2 hours) become `FAILED` and `CANCELLED`; none appear in customer history.

## Shipping (`lib/shipping`)
- Settings-driven shipping fee: flat fee, free threshold, optional per-state overrides. The same function is used by `priceCart` and the client display.
- Shiprocket: authenticate with a token cached server-side; pincode serviceability endpoint cached briefly; create order and shipment from a confirmed order; store `awb`, courier, label URL; tracking via webhook with a scheduled sync fallback; return pickups for approved returns; COD remittance fields updated from Shiprocket data.
- **Manual mode:** staff can paste a courier, AWB and tracking URL by hand. This is the launch fallback before Shiprocket KYC completes.

## Messaging (`lib/messaging`)
- `sendMessage({ templateKey, to, vars, kind })` loads the `MessageTemplate`, picks the channel (WhatsApp then email fallback), checks consent and frequency caps for `MARKETING` messages, sends, and writes `MessageLog`.
- WhatsApp templates must be approved by Meta; template names are stored per `MessageTemplate`. The list to submit early: login code (Authentication), order confirmed, COD confirmation request, shipped, out for delivery, delivered, refund processed, cancelled (Utility); abandoned cart, back in stock, promotion (Marketing).
- Failures are retried from the `EventOutbox` with backoff; permanent failures fall back to email.

## Marketing, analytics and attribution (`lib/analytics`)
- **Consent first:** nothing optional loads before the banner choice. Consent is recorded in `ConsentRecord` with notice version and channel.
- **Attribution:** on first landing store UTM parameters, click ids (`fbclid`), referrer and landing path in a first-party cookie and `AttributionTouch`; at order creation copy them to `Order.attribution`, including any influencer or referral code.
- **First-party events** (`view_item`, `add_to_cart`, `begin_checkout`, `purchase`, `search`, `search_no_result`) post to a lightweight endpoint (batched, consent-gated) into `AnalyticsEvent`; a retention job purges old rows. Funnels and campaign reports read from these and from orders.
- **Meta Pixel + Conversions API:** the browser pixel and the server send the same event with a shared `event_id` so Meta deduplicates them. Server events are queued through `EventOutbox`, include hashed email/phone only with marketing consent, and `Purchase` is sent when a prepaid order is paid or a COD order is confirmed (not at COD placement). Item ids in events match the catalog feed ids.
- **Feeds:** product feed routes for Google Merchant Center and Meta (id, title, description, link, image, price in INR, availability, brand, condition, variant group id).
- **GA4 and Google Ads conversions:** loaded only after marketing/analytics consent.

## SEO and AI discoverability (`lib/seo`)
- `generateMetadata` for home, category, collection, product, article and page routes: title, description, canonical, Open Graph and Twitter images; owner-editable SEO fields override defaults.
- **JSON-LD:** `Organization` (with `hasMerchantReturnPolicy` and `sameAs`), `WebSite`, `BreadcrumbList`, and `Product` with `Offer` (price, `INR`, availability as a full schema.org URL, condition, seller, `shippingDetails`, `hasMerchantReturnPolicy`). Markup values must match what is visible on the page.
- `app/sitemap.ts` (home, categories, collections, active products, articles, pages) and `app/robots.ts`: disallow `/admin`, `/api`, `/checkout`, `/account`; explicitly allow search and AI crawlers (Googlebot, Bingbot, OAI-SearchBot, GPTBot, Claude-SearchBot, ClaudeBot, PerplexityBot, Google-Extended, CCBot) while the `seo.allowAiCrawlers` setting is true. Confirm the CDN/WAF is not blocking them.
- Real category and collection URLs; slugs are derived from names with a short suffix only on collision; archived product URLs redirect to their category.
- Product facts (fabric, fit, measurements, care, return days, delivery times) and an FAQ are rendered as server HTML, not behind client-only tabs. `llms.txt` is optional and low priority.
- Performance: `next/image` with `sizes`, priority on the LCP image, blur placeholders from `ProductImage.blurDataURL`; ISR with `revalidateTag` fired by admin mutations; `generateStaticParams` for active products.

## Admin implementation notes
- **Settings registry:** every setting key has a zod schema and a default in code; reads are cached with tag revalidation; writes check permissions, require step-up where sensitive, and write an `AuditLog` row with before/after.
- **Rich text (policy pages, journal):** stored as sanitized HTML or Markdown; sanitized on save and again on render with an allowlist; scripts, event handlers and iframes are never allowed. A Content-Security-Policy backs this up.
- **Uploads:** signed upload URLs; allowed types and size limits enforced server-side; client compresses and creates a small blur data URL stored with the image.
- **Bulk operations and CSV import:** server-side validation with a dry-run preview, row-level errors, and an undo window where practical.
- **PWA and push:** web manifest and a minimal service worker for the admin scope; `PushSubscription` rows; push on new order, COD to confirm and new ticket.
- **Audit log:** every admin mutation of money, stock, settings, offers, roles and refunds is recorded with actor, entity, before/after and hashed IP.

## Security baseline
- Security headers (HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`); CSP introduced in report-only mode first, then enforced after verifying Razorpay, Meta, Google and Supabase origins.
- Same-origin checks for state-changing route handlers; Server Actions rely on Next's origin protection; cookies are `SameSite=Lax`.
- All inputs validated with zod; all admin routes and actions call `requireRole`; every webhook verifies its signature; cron routes verify `CRON_SECRET`.
- No PII in logs; OTP codes never logged outside the `console` provider in non-production.
- Dependency updates and `npm audit` in CI; secrets scanning before pushes.

## Scheduled jobs (Vercel Cron → `/api/cron/<name>`, all verify `CRON_SECRET`)
| Job | Cadence |
|---|---|
| `close-stale-orders` | every 30 min |
| `cod-reminders` | hourly |
| `abandoned-carts` | every 30 min (consent + frequency caps) |
| `release-rewards` | daily |
| `expire-wallet` | daily |
| `sync-shipments` | every 30 min (fallback to webhooks) |
| `process-outbox` | every 5 min |
| `daily-digest` | 09:00 IST |
| `low-stock` | daily |
| `purge-analytics` | weekly |
| `cleanup-auth` (expired OTPs, sessions) | daily |

## Environments, releases and data
- **Environments:** local (console OTP, test Razorpay), **staging** (Vercel preview + separate Supabase project + Razorpay test keys), **production** (live keys only here). Never point staging at the production database.
- **Migrations:** every schema change is a migration file reviewed before release; the `CHECK (stock >= 0)` constraint is a hand-written SQL migration. The first migration is a baseline created while no production data exists.
- **Backups:** Supabase backups (point-in-time recovery on a paid plan) plus a documented restore drill; a full admin data export exists for the owner.
- **Seed vs import:** a seed script creates the owner from `OWNER_EMAIL`, default settings, GST rules, message templates and legal page stubs; the real catalog arrives by CSV import, not by editing seeds.
- **Retention:** analytics events 13 months; OTP challenges and expired sessions purged daily; audit logs retained long-term; deletion requests anonymise PII but keep order and invoice records required for tax.

## Testing and quality gates
- **Vitest:** money helpers, pricing golden cases, GST per-line and place of supply, order transitions, wallet FIFO/expiry, OTP hashing and limits, safe redirects.
- **Playwright (staging):** guest → cart → OTP → prepaid payment with Razorpay test cards; double-click and retry (no duplicate order); payment failure and retry; COD placement and confirmation; coupon vs automatic comparison; cancel and refund; admin ship flow; mobile viewport (375px) and desktop.
- **Lighthouse CI:** LCP, CLS and INP budgets on home, category and product pages.
- **CI (GitHub Actions):** install, `prisma validate`, `tsc --noEmit`, lint, tests, build. Checks must pass before the owner is shown a staging build.
- **UAT:** the owner completes a scripted checklist on staging (phone and laptop) before launch.

## Non-functional notes
- Prices, discounts, tax and shipping are always recomputed on the server; the client never dictates an amount.
- Rate-limit every public mutation endpoint (OTP send/verify, create-order, coupon check, gift-card redeem, contact form, referral lookup) with named policies in `lib/ratelimit`.
- Failures in secondary systems (messaging, ad events, Shiprocket) never block an order; they queue and retry.
