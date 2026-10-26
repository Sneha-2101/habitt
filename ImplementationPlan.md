# Implementation Plan — Habitt

## Working rules (every milestone)
- Work is executed by Angy from Implementation Plan–style prompts, one milestone at a time, in numbered phases.
- **Angy never commits, stages or pushes.** Aarav reviews, commits and pushes to `main` himself after a full milestone is verified.
- After **every phase** Angy runs the phase checks (`npx tsc --noEmit`, `npm run lint`, `npm run build`, plus any phase-specific commands) and pastes the **raw output**. Reports are cross-checked, not trusted.
- Every milestone ends with a **read-only verification phase**: no file edits, only commands, greps and quoted code lines proving each claimed item exists, plus an explicit list of anything not done.
- Each milestone is deployed to **staging** and reviewed (by Aarav, and by the owner for content and policy) before the next starts.
- Scope is frozen. New ideas go to the post-launch backlog unless they replace something in the plan.
- Anything blocked on external paperwork ships **switched off behind a settings flag** and is enabled without a deploy once the dependency clears.

## Status summary (honest baseline from the repo audit)
| Original phase | Status |
|---|---|
| Phase 0 — Setup | Done |
| Phase 1 — Storefront core | Done (gaps: no gallery, no sort/search, plain `<img>`, placeholder nav links) |
| Phase 2 — Checkout & payments | Code-complete, **never tested end to end**; known defects (see M1) |
| Phase 3 — Admin panel | Basic CRUD done; **no per-action authorization**, unrestricted order status changes |
| Phase 4 — Hardening | **Partial.** Password hashing and mobile pass done; security, payment integrity and validation gaps remain |
| Phase 5 — Launch | Not started |

Known defects the plan must close: fallback JWT secret; admin actions with no role check; no quantity validation (negative or fractional quantities and duplicate lines bypass stock and price checks); archived/draft products purchasable; unguarded stock decrement; orphaned Razorpay orders on retry; random 5-digit order ids with collision risk; no `payment.failed` handling; success page with no ownership check and a false "email sent" claim; shipping fee not shown in the pay button; unsanitized redirect; the seed admin password; lint not runnable; docs out of date.

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

## M1 — Foundation and hardening
**Scope**
- Baseline: install, validate, type-check, build; fix whatever fails.
- Security: remove the JWT secret fallback; `requireUser`/`requireRole` guards; role checks inside every admin action and the admin order status action; `safeRedirect`; seed the owner from `OWNER_EMAIL` plus a temporary `SEED_OWNER_PASSWORD` (password login is removed in M2) and never overwrite an existing owner's password; confirm Next.js is on a patched 15.x.
- Schema: split `Order.status` into `paymentStatus` and `fulfilmentStatus`; add `paymentMethod`, `idempotencyKey`; add `ProcessedWebhook` and `StockMovement`; `CHECK (stock >= 0)`; move to Prisma migrations.
- Payments: shared `markOrderPaid`; guarded stock decrement; webhook de-duplication and `payment.failed`; ownership checks on verify and the success page; Razorpay order reuse on retry; zod-validated `create-order` (integer quantities, merged duplicates, active products only); idempotency keys; crypto-based display ids with collision retry; shared shipping calculation; stale-order cleanup job.
- Checkout page: show shipping and total on the pay button, labels and validation, `payment.failed` handler, error handling.
- Admin orders: legal transitions only; cancelling restocks; no manual "paid".
- Infrastructure: Upstash rate limiting on `create-order`; Sentry; security headers (CSP in report-only); GitHub Actions CI; ESLint; Vitest with first tests; `.env.example`; README fixes.
**Exit criteria:** Razorpay **test-mode** end-to-end run passes, including retry, double-click, payment failure and webhook-only confirmation; no negative stock possible; all guards verified by the read-only phase; CI green; staging deployed.

## M2 — Identity
**Scope:** OTP challenge module with hashing, limits and Turnstile; WhatsApp and email providers plus console provider; Auth.js credentials provider; `Session` table with revocation; sliding sessions; sign-in sheet at checkout and `/login`; guest cart synced to a server `Cart` at sign-in; addresses; account area basics; step-up verification; staff/owner email-OTP login with allowlist; new-device alert; `AuditLog`; minimal `Setting` with feature flags; removal of password login and the seeded password; reviewer test-account flag.
**Exit:** all login paths work on staging (console provider, email live; WhatsApp live only if Meta verification is complete); rate limits and neutral responses verified; sign out everywhere works.

## M3 — Pricing and checkout
**Scope:** `Category` table and owner-editable size sets; product fields (compare-at, cost, HSN, SEO, fabric/fit/care); variant color and SKU; `priceCart()` engine with unit tests; offers (coupons, automatic, combos, tiers, free shipping, gift, scheduled sale prices) with stacking rules and the coupon-vs-automatic comparison; cart UI with savings breakdown and nudges; prepaid discount; COD with eligibility and fee; wallet tender hook (balance zero until M6); shipping settings; GST rules, per-line tax, place of supply, invoice numbering and PDF (receipt mode until GSTIN); address book with pincode autofill; GSTIN field; consent records for checkout opt-ins; checkout steps from `AppFlow.md`.
**Exit:** pricing and GST golden tests pass; staging test orders (prepaid and COD) produce correct totals and invoices; no total is ever computed on the client.

## M4 — Fulfilment and messages
**Scope:** Shiprocket integration (serviceability, shipment creation, AWB, labels, tracking sync and webhook) with the manual fallback; COD confirmation flow; order timeline and public tracking page; cancel; returns and size exchanges with photos; refunds to source or wallet credit; credit notes; message templates and the notification matrix on WhatsApp and email; support tickets with 48-hour and one-month clocks; policy and legal page stubs and footer disclosures; `EventOutbox`; all scheduled jobs.
**Exit:** a staged order moves through every state; a return and a refund complete with a credit note; templates submitted to Meta; grievance flow tested.

## M5 — Owner admin
**Scope:** responsive admin shell (sidebar and bottom tabs), card-and-table list pattern, bottom-sheet actions; needs-attention inbox; orders tools (search, saved views, bulk actions, notes, contact buttons); product tools (bulk edit, CSV import/export, duplicate, scheduled publish, image reorder and bulk upload, stock history and stock-take); collections; settings screens for every key; content editor (home sections, banners, navigation, pages, FAQs, journal) with sanitization, preview and scheduling; customers and segments; staff and roles; audit log viewer; reports and metrics dashboard (sales, funnel, products, coupons, RTO, COD remittance, GST export, settlement reconciliation, profit); daily digest; PWA with push; data export; maintenance mode; command menu (desktop).
**Exit:** every item on the PRD **no-code list** is changeable from the admin on a phone; owner walkthrough on staging signed off.

## M6 — Rewards
**Scope:** wallet ledger with expiry and earliest-expiry spending; wallet as a checkout tender; loyalty release after the return window; referrals with fraud checks; gift cards (purchase product, delivery, redemption into wallet, liability report); refund-to-credit with optional bonus; influencer codes, tracked links, commission records, payout CSV and the optional read-only link.
**Exit:** wallet balance always equals the ledger sum (tested); rewards only release after delivery plus return window; fraud checks tested.

## M7 — Storefront polish and growth
**Scope:** the applicable UX tips (skeletons, undo toasts, optimistic admin updates, interruptible animations, swipe-to-dismiss sheets, back-button-aware drawers, hit slop, safe areas, tabular numbers, balanced headings, optional view transitions); gallery, zoom, sort, filters and typo-tolerant search; size recommender; recently viewed and "complete the look"; wishlist; verified-buyer reviews with photos; back-in-stock requests; WhatsApp share; `next/image` with blur placeholders and ISR; SEO (metadata, JSON-LD, sitemap, robots, category URLs, redirects); consent banner and preferences, data export and deletion; attribution capture; first-party events; Meta Pixel and Conversions API with outbox; GA4/Ads; product feeds; campaign link builder, `?offer=CODE`, landing pages, link-in-bio; ad-spend entry and per-campaign ROAS and RTO; lifecycle messages (welcome, abandoned cart, back-in-stock, review request, win-back) with frequency caps; segments export; CSP enforced.
**Exit:** Lighthouse budgets pass on key pages; Rich Results validation passes for product pages; Events Manager shows deduplicated pixel and server events; consent changes take effect immediately.

## M8 — Launch readiness
**Scope:** security review against `TechSpec.md`; Playwright suite green on staging; UAT checklist completed by the owner; legal and policy text reviewed by the CA or a lawyer; real catalog imported; live Razorpay, Shiprocket and WhatsApp keys configured; `gst.enabled = true` with the real GSTIN; reviewer account disabled; backups and restore drill; monitoring and alerts verified; runbook and admin guide written; soft launch with friends-and-family orders; ad pixel verified, then public launch and ads; account ownership (Vercel, Supabase, domain, Meta, Google, Razorpay, Shiprocket) transferred to the owner and support terms agreed.
**Exit:** a real prepaid and a real COD order complete end to end on production; the owner confirms they can operate the store unaided.

---

## Feature flags (settings) used to ship around blocked dependencies
`flags.whatsappOtp` (off until Meta verification) · `flags.cod` (off until Shiprocket KYC) · `gst.enabled` (off until GSTIN; store must not take real orders while off) · `flags.reviews` · `flags.wishlist` · `site.maintenanceMode` · `REVIEWER_OTP_ENABLED` (env).

## Definition of done (per milestone)
1. All listed scope implemented and demonstrated on staging.
2. Type-check, lint, unit tests and build pass in CI.
3. Read-only verification phase output reviewed by Aarav against the code.
4. Docs updated (any decision that changed is reflected here and in the relevant doc).
5. Aarav commits and pushes; the owner reviews staging for owner-facing changes.

## Post-launch backlog (not in the frozen scope)
Loyalty tiers, subscriptions, wholesale pricing, marketplace sync, multi-warehouse, native apps, international shipping, live chat tooling, Hindi/regional language toggle.
