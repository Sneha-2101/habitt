# Implementation Plan — Habitt

## Working rules (every milestone)
- Work is executed by Angy from Implementation Plan–style prompts, one milestone at a time, in numbered phases.
- **Angy never commits, stages or pushes.** Aarav reviews, commits and pushes to `main` himself after a full milestone is verified.
- After **every phase** Angy runs the phase checks (`npx tsc --noEmit`, `npm run lint`, `npm run build`, plus any phase-specific commands) and pastes the **raw output**. Reports are cross-checked, not trusted.
- Every milestone ends with a **read-only verification phase**: no file edits, only commands, greps and quoted code lines proving each claimed item exists, plus an explicit list of anything not done.
- Each milestone is deployed to **staging** and reviewed (by Aarav, and by the owner for content and policy) before the next starts.
- Scope is frozen. New ideas go to the post-launch backlog unless they replace something in the plan.
- Anything blocked on external paperwork ships **switched off behind a settings flag** and is enabled without a deploy once the dependency clears.

### Standing rules for every Angy prompt (learned the hard way)
- Angy never runs `git commit/add/push/pull/merge/stash/reset/checkout`. Aarav does all git, straight to `main`, after a full phase.
- Angy never reads or prints `.env` / `.env.local` values (names only, or "set"/"unset"/true/false).
- Angy never runs `npm install/i/update/upgrade/audit fix` and never changes `package.json` or `package-lock.json`; `npx` only with `--no-install` (answer "n" to any download prompt). **Prisma stays 5.22.0.**
- Migrations are hand-written SQL (no BOM) applied with `prisma migrate deploy`; never `migrate reset` or `db push`. Gate every database run with `npx --no-install prisma migrate status`. Test rows are prefixed `m1test` and only those are deleted.
- Raw output after every phase: `tsc --noEmit`, lint (0 errors; baseline 41 warnings), unit tests, integration where relevant (start `next dev` first and prove it with the health route), build at the end. Any failed run makes the phase PARTIAL.
- Angy must not edit a test or production file just to get green; it reports and stops. Every prompt asks for the full `git diff` of every **existing** file edited, a DONE/PARTIAL/NOT DONE table, `git status --short` and `git diff --stat`.
- Angy's reports are unreliable (it has invented code quotes and edited tests to pass), so every report is cross-checked against the repo and the diff before anything is committed.

## Status summary (as built, after M3a)
| Milestone | Status | Notes |
|---|---|---|
| M0 Paperwork | Ongoing (owner) | See the tracker below. |
| M1 Foundation and hardening | **Done, committed** | Deviations from the plan: the `paymentStatus`/`fulfilmentStatus` split was moved to M3a; Sentry is in M8; CI exists. |
| M2a Identity core | **Done, committed** | Session table checked on every protected action, staff email-OTP login with an owner-editable allowlist, audit log, new-device alert, sign out everywhere, passwords and signup removed. |
| M2b Cart, addresses, contact | **Done, committed** | Server cart and sync, address book, contact change, customer step-up, verified-at fields, reviewer login. |
| M2 follow-ups (fix-4, fix-5, addendum, cart timeouts) | **Done** | `maskIdentifier` fix, deterministic T8, T10 settings isolation, stable Turnstile test env, env-only `WHATSAPP_OTP_LIVE` with a production gate on phone login, phone step-up and phone contact change, `$transaction` `maxWait`/`timeout` on cart actions. |
| M2 staging exit check | **Deferred until after M8** | Run `M2-STAGING-EXIT-CHECKLIST.md` against a real staging deployment. |
| M3a-1 Order status split | **Done, committed** | Split `Order.status` into `paymentStatus` + `fulfilmentStatus` (migrations 7-8). |
| M3a-2 Category table & sizes | **Done, committed** | Dynamic `Category` table + sizes array (migrations 9-10). |
| M3a-2b Product merchandising fields | **Done, committed** | Compare-at, cost price (Prisma `omitApi`), HSN, fabric/fit/care, size chart, SEO (migration 11). |
| M3a-2c Variants & order snapshots | **Done, committed** | Size x color x SKU variants and `OrderItem` snapshots (migration 12). |
| M3b-1 Collections & Offers foundation | **In Progress** | Schema, pure validation, admin UI, coupon backfill. |
| M3b-2 Offers evaluation engine | **Planned** | Pricing quote engine multi-step evaluation, order creation integration, coupon retirement. |
| M3c onwards | Not started | Re-planned below. |

### Known issues carried into later milestones
- **M3:** a coupon worth 0 does not count toward `timesUsed`; coupon codes are not forced uppercase on admin save; `create-order` matches an "already used" message string instead of a warning code; GST invoice maths is wrong and unnumbered; the free-shipping threshold uses the post-coupon subtotal; `/login` still opens on the phone tab.
- **M4:** bulk fulfilment shows generic per-row errors (restore the reasons for staff).
- **M7:** Meta Pixel loads without consent and `Purchase` refires on refresh; the header reads the session, so the whole site is dynamic (blocks ISR/SEO); a welcome-coupon email failure leaves a subscriber with no coupon.
- **M8:** 41 lint warnings; 13 `npm audit` findings; CSP is report-only; verify and webhook transactions need `maxWait`/`timeout`; break-glass owner-recovery script; reviewer login must be disabled; real-provider tests (Upstash, Turnstile, Meta) never run live; `OtpCode.identifier` is stored raw; Prisma upgrade only as its own planned task.

## Open decisions for the re-plan (confirm one at a time, before the milestone that needs them)
| # | Decision | Recommended default | Needed by |
|---|---|---|---|
| D1 | Split `Order.status` into `paymentStatus` + `fulfilmentStatus` | Yes, in M3a, with a backfill migration | M3a |
| D2 | Wallet: evolve `StoreCreditTransaction` / `storeCreditBalance` in place (add expiry) instead of creating `Wallet`/`WalletEntry` | Evolve in place | M6 |
| D3 | Migrate `Coupon` rows into the new `Offer` model | Migrate in M3b | M3b |
| D4 | Keep the typed `SiteSettings` singleton (new settings = new columns) instead of a key-value `Setting` table | Keep typed | M3a |
| D5 | Split M3 into M3a (data model), M3b (offers and pricing), M3c (GST and invoices) | Split | now |

## External dependency tracker (owner-side, starts now, sets the launch date)
| Dependency | Unblocks | Notes |
|---|---|---|
| GSTIN issued | live tax invoices, Razorpay live KYC, Shiprocket KYC and COD, Meta business verification | in progress at the owner's end |
| Domain purchased in the owner's name | email DNS (Resend), Razorpay website review, Search Console, Meta domain verification | |
| Business email and support phone | Razorpay/Shiprocket KYC, legal pages | |
| Razorpay KYC and website review | live payment keys | needs policy pages live first; reviewer test account |
| Shiprocket KYC | real shipments, COD enablement, pincode serviceability | manual AWB entry is the fallback |
| Meta Business account + verification, WhatsApp number and template approvals | WhatsApp OTP and messages | email OTP is the fallback; verify +91 delivery of Authentication templates early |
| Facebook Page, Instagram professional account, ad account | ads, catalog | |
| Google account (Search Console, Merchant Center, GA4) | discovery and feeds | |
| Paid Vercel and Supabase plans in the owner's name | commercial hosting, backups | |
| Decisions: returns window, shipping rules, COD limits and fee, prepaid discount, COD confirmer | M3–M4 settings | see PRD open decisions |
| CA answers: bundle allocation, COD fee, shipping, gift card and loyalty GST, invoice numbering, credit notes | M3 GST layer | |
| Product content: photos, copy, size charts, HSN, stock, brand story | M5 catalog import, M7 | |
| Developer-side free setup: Razorpay test account, staging Supabase, Meta developer app + WhatsApp test number, Upstash, Sentry, Turnstile | M1–M2 | no business paperwork needed |

---

## M0 — Parallel paperwork (owner, continuous)
Run the tracker above. Developer sends the owner the checklist and follows up weekly. **Exit:** GSTIN, domain, WhatsApp number, Meta/Google accounts and the policy decisions are in hand.

## M1 — Foundation and hardening — DONE (committed)
Built: payment integrity (`markOrderPaid`, guarded stock decrement, webhook de-duplication, `payment.failed`, idempotency keys, ownership checks, crypto display ids), shared quote engine (`lib/pricing/quote.ts`), Upstash rate limiting with per-policy fail mode, OTP hardening, launch settings in `SiteSettings`, security headers (CSP report-only), health route, CI workflow, Vitest suites, migrations replacing `db push`. **Not done and rescheduled:** status split (M3a), Sentry (M8), CI first run (M8).

## M2 — Identity — DONE (committed) except the staging exit check
Built: `Session` table checked on every protected action; customer sessions 365 days sliding, staff 7 days idle / 30 days absolute; staff email-OTP login at `/staff/login` with the `StaffAllowlist` (owner-editable at `/admin/team`); new-device alert; `AuditLog`; sign out everywhere; passwords, signup and bcrypt removed; server `Cart` and sync; address book (max 10); contact change; customer step-up; reviewer login (env flag); env-only `WHATSAPP_OTP_LIVE` with a production gate on every phone OTP path. **Deferred:** the staging exit check (`M2-STAGING-EXIT-CHECKLIST.md`, run after M8). **Decisions still standing:** email OTP only until Meta WhatsApp is live; never auto-merge accounts; never reveal whether an email or phone is registered.

## M3 — Catalog model, pricing and checkout (split into three parts)
Each part ends with its own read-only verification and a commit. Migrations are hand-written SQL with backfills (see `Schema.md` Part 2).

### M3a — Data model — DONE (committed)
**Scope:** `Category` table (seeded from the four enum values) and owner-editable size sets (E1); variant `color` and `sku` (E2); product fields: compare-at, cost, HSN, fabric/fit/care, size chart, SEO, `publishAt` (E3); **order status split** with backfill, all transition code and tests moved together (E4, D1); admin product form and storefront reads updated; `/login` defaults to the email tab and hides the phone tab until `WHATSAPP_OTP_LIVE` is true (small UI fix carried from M2).
Completed in sub-phases:
- M3a-1: Split `Order.status` into `paymentStatus` + `fulfilmentStatus` (migrations 7-8).
- M3a-2: Dynamic `Category` table with position and sizes array (migrations 9-10).
- M3a-2b: Product merchandising fields, compare-at, cost price (Prisma `omitApi`), fabric/fit/care, SEO (migration 11).
- M3a-2c: Variants size x color x SKU, `OrderItem` snapshots (migration 12).

### M3b — Offers and pricing
Split into M3b-1 (foundation) and M3b-2 (engine):

#### M3b-1 — Collections + Offers foundation (In Progress)
- **Schema & Migrations:**
  - `Collection` and `ProductCollection` join table.
  - `OfferKind` enum: `PERCENT_OFF`, `FLAT_OFF`, `TIER`, `COMBO_ANY`, `COMBO_SLOTS`, `GIFT`.
  - `OfferAudience` enum: `ALL`, `FIRST_ORDER`, `BIRTHDAY`.
  - `Offer` model (name, kind, code, active, dates, usage limits, priority, audience, config Jsonb, legacyCouponId).
  - `OfferTarget` (offerId, categoryId, productId, collectionId with check `num_nonnulls = 1`).
  - `OfferRedemption` (offerId, orderId, userId, amountPaise).
  - `OrderDiscountKind` enum and `OrderDiscount` model.
  - `OrderItem` discountPaise and isGift fields.
  - Backfill migration: `Coupon` rows backfilled into `Offer` with legacyCouponId.
- **Pure Validation:** `lib/offers/schema.ts` (Zod schemas for config unions, cross-field rules, describeOffer helper).
- **Server Actions:** `lib/actions/collections.ts`, `lib/actions/offers.ts` (requireStaff, audit logs, atomic target updates).
- **Admin UI:** Collections manager (`/admin/collections`), Offers manager (`/admin/offers`, `/new`, `/[id]`), product form collections multi-select.

#### M3b-2 — Offers evaluation engine (Planned)
- Multi-step offer evaluation engine in `lib/pricing/quote.ts` (combos, tiers, automatic offers, exclusive coupon code with better-of comparison, gift items, per-line discount allocation).
- Order checkout integration (`OrderDiscount` records, `OfferRedemption` records, safe discount allocation).
- Deprecation and dropping of legacy `Coupon` table and legacy coupon admin.

### M3c — GST and invoices
**Scope:** `GstRule`, `Invoice`, `CreditNote`, `InvoiceCounter`, per-line tax fields (E7); place of supply from `businessState` (Punjab) versus the shipping state; invoice numbering and a server-side PDF; receipt mode while `gstEnabled` is false; buyer GSTIN field; consent records for checkout opt-ins; checkout steps per `AppFlow.md` (address book with pincode autofill).
**Blocked on:** the CA answers (bundle allocation, COD fee, shipping, gift cards and loyalty, invoice numbering, credit notes) and the GSTIN. Ships behind `gstEnabled`; the store must not take real orders with tax off.
**Exit:** GST golden tests pass; staging prepaid and COD orders produce correct totals and invoices.

## M4 — Fulfilment, returns, messages and support
**Scope:** Shiprocket (serviceability, shipment, AWB, labels, tracking webhook and sync) with the manual fallback; `Shipment`/`ShipmentEvent` and the move of courier fields off `Order` (E11); COD confirmation flow; order timeline and public tracking page; cancel; returns and size exchanges (`Return`/`ReturnItem`/`Refund`, E10); refunds to source or wallet credit; credit notes; message templates and the notification matrix (email first; WhatsApp when Meta is live); support tickets with 48-hour and one-month clocks; policy and legal pages and footer disclosures (returns 7 days, company pays return shipping, refund **started** within 48 hours, no promise about bank credit time; maximum delivery 7 days; grievance officer); `EventOutbox`; restore per-row reasons in bulk fulfilment; **decide the scheduler** (Vercel Pro or an external caller of the cron routes with `CRON_SECRET`) and add the remaining jobs.
**Exit:** a staged order moves through every state; a return and a refund complete with a credit note; templates submitted to Meta; the grievance flow is tested.

## M5 — Owner admin
**Scope:** responsive admin shell (sidebar and bottom tabs), card-and-table lists, bottom-sheet actions, needs-attention inbox; orders tools; product tools (bulk edit, CSV, duplicate, scheduled publish, image reorder and bulk upload, stock history and stock-take, `StockMovement` relation); collections; settings screens for every setting (typed `SiteSettings` columns, audit-logged saves, D4) including owner-editable business address, phone and emails (never hardcoded); content editor and the content tables (E13) with sanitisation, preview and scheduling; customers and segments; staff and roles; audit log viewer; reports and metrics; daily digest; PWA with push; data export; maintenance mode; command menu (desktop).
**Exit:** every item on the PRD **no-code list** is changeable from the admin on a phone; owner walkthrough on staging signed off.

## M6 — Rewards
**Scope:** the one wallet, evolved in place (E9, D2): expiry and earliest-expiry spending on `StoreCreditTransaction`; wallet as a checkout tender (already partly present as `storeCreditApplied`); loyalty release after the return window; referrals with fraud checks; gift cards (purchase, delivery, redemption into the wallet, liability report); refund-to-credit with an optional bonus; influencer codes, tracked links, commission records, payout CSV.
**Exit:** wallet balance always equals the ledger sum (tested); rewards release only after delivery plus the return window; fraud checks tested.

## M7 — Storefront polish and growth
**Scope:** UX items in `Design.md` (skeletons, undo toasts, optimistic admin updates, interruptible animations, swipe-to-dismiss sheets, back-button-aware drawers, safe areas, tabular numbers); gallery, zoom, sort, filters, typo-tolerant search; size recommender; recently viewed and "complete the look"; reviews with moderation, photos and verified buyers (E15); back-in-stock; WhatsApp share; `next/image` with blur placeholders; **make the header not read the session so pages can use ISR**; SEO (metadata, JSON-LD, sitemap, robots, category URLs, redirects); consent banner and preferences, data export and deletion; attribution capture; first-party events; **Meta Pixel only after consent, `Purchase` not refired on refresh**, Conversions API with the outbox; GA4/Ads; product feeds; campaign links, `?offer=CODE`, landing pages, link-in-bio; ad-spend entry; lifecycle messages with frequency caps; **welcome-coupon email failure retried** so a subscriber is never left without a coupon; CSP enforced after testing Razorpay, Meta Pixel, Turnstile and Supabase images.
**Exit:** Lighthouse budgets pass on key pages; Rich Results validation passes for product pages; Events Manager shows deduplicated pixel and server events; consent changes take effect immediately.

## M8 — Launch readiness
**Scope:** security review against `TechSpec.md`; **hash `OtpCode.identifier`** (E8); `maxWait`/`timeout` on the verify and webhook transactions; clear the 41 lint warnings and the 13 `npm audit` findings (never `audit fix`); break-glass owner-recovery script; Sentry and uptime alerts; real Turnstile keys and real-provider tests (Upstash, Turnstile, Meta); Playwright suite green on staging; CI runs on the Node version actually used and has been seen green; UAT checklist completed by the owner; legal and policy text reviewed by the CA or a lawyer; real catalog imported; live Razorpay, Shiprocket and WhatsApp keys; `gstEnabled` true with the real GSTIN; **reviewer login disabled**; backups and restore drill; runbook and admin guide; **run `M2-STAGING-EXIT-CHECKLIST.md`**; soft launch with friends-and-family orders; pixel verified, then public launch; account ownership (Vercel, Supabase, domain, Meta, Google, Razorpay, Shiprocket) transferred to the owner; Prisma upgrade only as its own planned task; merge `origin/main` with `-s ours` once and push (never force).
**Exit:** a real prepaid and a real COD order complete end to end on production; the owner confirms they can operate the store unaided.

---

## Feature flags and switches (as built and planned)
- **Environment (today):** `WHATSAPP_OTP_LIVE` (exact `"true"`; off until Meta verification and the template are approved), `REVIEWER_OTP_ENABLED` with `REVIEWER_OTP_CODE`, `REVIEWER_IDENTIFIER`, `REVIEWER_OTP_EXPIRES_AT` (must be off at launch), `OTP_DAILY_CAP`.
- **`SiteSettings` columns (today):** `codEnabled` (COD), `gstEnabled` (off until GSTIN; the store must not take real orders while off), `codRequiresDeliveredOrder`, `freeShippingOnPrepaid`, `codFeeEnabled`.
- **Planned columns (M5):** reviews on/off, wishlist on/off, maintenance mode, AI-crawler toggle.

## Definition of done (per milestone)
1. All listed scope implemented and demonstrated on staging.
2. Type-check, lint, unit tests and build pass in CI.
3. Read-only verification phase output reviewed by Aarav against the code.
4. Docs updated (any decision that changed is reflected here and in the relevant doc).
5. Aarav commits and pushes; the owner reviews staging for owner-facing changes.

## Post-launch backlog (not in the frozen scope)
Loyalty tiers, subscriptions, wholesale pricing, marketplace sync, multi-warehouse, native apps, international shipping, live chat tooling, Hindi/regional language toggle.
