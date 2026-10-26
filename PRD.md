# PRD — Habitt

## Problem statement
Habitt is a minimalist D2C clothing brand (shirts, overshirts, polos, trousers) inspired by Rare Rabbit's aesthetic. The brand needs a storefront where customers can browse, buy and pay online (prepaid or cash on delivery), and an admin panel the owner can run from a phone or a laptop **without ever asking a developer to change code**: products, prices, offers, content, shipping rules, tax settings, staff, and sales metrics are all editable in the admin.

## Product principles
1. **The owner never needs a developer for day-to-day changes.** If it can change (a coupon, a banner, a policy page, a shipping fee, a COD limit), it lives in the database and the admin, not in code.
2. **The server is the only source of truth for money.** Prices, discounts, tax, shipping and payment status are computed and verified on the server. The browser only displays.
3. **Mobile first, twice.** Most shoppers and most admin sessions will be on a phone. Every customer and admin screen is designed for 375px first and enhanced for desktop.
4. **Low friction to buy.** Browse and fill the cart as a guest. Verify with a one-time code only at checkout. Returning customers stay signed in.
5. **Prepaid-friendly, COD-supported.** COD is available, with protections against return-to-origin losses, and a prepaid discount nudges customers to pay online.
6. **Compliance by design.** GST invoices, mandatory seller and grievance disclosures, and consent for marketing are product features, not afterthoughts.

## Users and roles
| Role | Who | Access |
|---|---|---|
| **Visitor (guest)** | anyone | browse, search, wishlist locally, build a cart, read content |
| **Customer** | verified by phone or email OTP | checkout, orders, addresses, wallet, wishlist, reviews, returns, support tickets |
| **Staff** | owner's team (1–5 people) | day-to-day operations per the permission matrix in `TechSpec.md` |
| **Owner** | brand owner | everything, including settings, staff, refunds, exports, metrics on revenue and profit |
| **Influencer** (optional, read-only) | creators with a code | a private link showing their own orders and commission, no login required beyond the link |

Customers and staff share one `User` table, distinguished by `role`. Customers log in with a **WhatsApp OTP** (primary) or **email OTP**. Staff and owner log in with **email OTP only**, restricted to addresses the owner has added. There are no passwords anywhere in the product.

## Scope (all in scope for the first launch)

### 1. Storefront and discovery
- Home page assembled from owner-editable sections (hero, collections, banners, text), plus an announcement bar.
- Shop with category and collection pages on real URLs (`/shop/shirts`), filters (size, color, price, in stock), sort (newest, price), and search with typo tolerance.
- Product page: image gallery with zoom, color and size selection, true stock messaging, size chart and fit notes, size recommender, fabric/care details, reviews, FAQ, "complete the look", recently viewed, WhatsApp share, back-in-stock request per size.
- Cart drawer with offer breakdown and nudges ("add ₹400 for free shipping", "add 1 more for the combo price").
- Wishlist (local for guests, synced after login).
- Content pages (About, policies, FAQ, size guide) and a journal, all editable in admin.

### 2. Identity and account
- Guest browsing and cart; OTP sign-in sheet at checkout (WhatsApp first, email fallback); returning customers are never asked again on the same device.
- Account area: orders and tracking, addresses, wallet (credit, rewards, gift cards), wishlist, referral code, communication preferences, data export and account deletion, sign out and "sign out of all devices".
- Customers verify again only to change their phone or email.

### 3. Checkout and payments
- Address book with pincode-based city/state autofill; optional business GSTIN for B2B invoices.
- Payment methods: UPI, cards, netbanking and wallets through Razorpay (prepaid), and cash on delivery.
- Prepaid discount (owner-configurable), optional COD fee (shown before the final step), wallet credit as a payment tender.
- Idempotent order creation (no duplicate orders from double taps or retries), clear failure and retry paths, no order marked paid without a verified payment.

### 4. Orders, fulfilment and returns
- Order timeline and live courier tracking; WhatsApp and email updates at each stage.
- COD confirmation step before shipping (owner-configurable).
- Shiprocket integration: shipment creation, AWB, labels, tracking sync, pincode serviceability, COD remittance tracking.
- Self-serve cancel (before shipping), return and size-exchange requests with photos, refunds to the original method or to wallet credit, credit notes.
- GST tax invoices generated per order; credit notes for returns.

### 5. Offers and rewards (owner-configurable)
- Coupons and automatic offers: percent, flat, free shipping, fixed-price combos, buy-X-get-Y, quantity tiers, spend tiers, gift with purchase, scheduled sale prices.
- Stacking rules: automatic offers stack with each other; one exclusive coupon per cart (the system applies whichever saves the customer more and says so); the prepaid discount stacks on top; a global maximum-discount cap and optional cost-price floor protect margins.
- One **wallet** per customer (rupee ledger with expiry) powering loyalty rewards, referral rewards, gift-card redemption and refund-to-credit.
- Referrals, gift cards, and influencer codes with commission tracking (commission released only after the return window).

### 6. Owner admin (no-code control panel, phone and desktop)
- **Needs-attention inbox:** COD orders to confirm, paid orders to ship, failed payments, return requests, open tickets, low stock.
- **Orders:** search by id, phone or email; saved filter views; ship with AWB; bulk mark-shipped, labels and packing slips; refunds with re-verification; internal notes and tags; tap-to-call and WhatsApp.
- **Catalog:** products, variants (size and color), categories and size sets, collections, bulk edit, CSV import and export, duplicate, scheduled publish, image reordering and bulk upload, stock history and stock-take mode.
- **Offers:** create, schedule, pause, duplicate, simulate against a test cart, and view performance.
- **Content:** homepage sections, banners, navigation, policy and static pages, FAQs, journal articles; preview as customer; scheduled changes.
- **Settings:** store identity and GSTIN, shipping, COD, prepaid discount, GST rules, offer stacking caps, loyalty, return window, low-stock threshold, SEO and AI-crawler toggle, maintenance mode, feature flags.
- **Customers and support:** customer timeline (view-only), segments, tickets with the legal acknowledgement and resolution clocks.
- **Staff:** invite by email, roles, audit log, new-device sign-in alerts.
- **Metrics:** sales, orders, AOV, funnel, abandoned carts, payment failures, refunds, RTO rate by pincode and campaign, COD vs prepaid, new vs returning, coupon performance, top and slow products, sales by category and state, search terms with no results, GST report, settlement and COD-remittance reconciliation, profit per product when cost is set.
- **Daily digest** (yesterday's sales, orders to ship, low stock) by WhatsApp or email; push alerts on new orders from the installed admin.
- Installable to the home screen (PWA); full data export; maintenance-mode toggle.

### 7. Marketing and growth
- Meta Pixel plus server-side Conversions API with shared event ids; Google Analytics 4 and Google Ads conversions; consent-gated.
- Product catalog feeds for Google Merchant Center and Meta; UTM and click-id capture stored on orders; campaign link builder; `?offer=CODE` auto-apply links; campaign landing pages; editable link-in-bio page.
- Ad-spend entry with per-campaign ROAS and RTO rate.
- Email and WhatsApp lifecycle messages: welcome, abandoned cart, back-in-stock, review request, win-back; template editor with on/off switches; frequency caps; separate opt-ins.
- Audience segments with hashed export for Meta custom audiences.
- Reviews with photos (verified buyers only).

### 8. SEO and AI discoverability
- Per-page metadata, canonical URLs, Open Graph, structured data (Organization, WebSite, Breadcrumb, Product with Offer, shipping and return policy), sitemap, robots.
- All search and AI crawlers allowed by default (owner toggle); server-rendered product facts in plain HTML; FAQ on product pages; consistent brand identity data.
- Core Web Vitals budgets; image optimisation and blur placeholders.

### 9. Platform quality
- Skeleton loaders, undo toasts, optimistic updates in admin, interruptible animations, swipe-to-dismiss sheets, back-button-aware drawers, safe-area insets, 44px touch targets, tabular numerals, balanced headlines (details in `Design.md`).
- Error monitoring, uptime checks, backups, staging environment, automated tests on money logic and the payment flow.

## Non-goals (explicitly out of scope for launch)
Marketplace sync (Amazon, Flipkart), native mobile apps, international shipping and multi-currency, wholesale/B2B pricing tiers, subscriptions, multi-warehouse inventory, multi-vendor, in-house logistics, live chat agent software, loyalty tiers beyond the single wallet. Anything not listed in Scope goes to a post-launch backlog unless it replaces something.

## Compliance requirements
- **GST:** tax invoice per paid order (GSTIN, HSN, per-line taxable value, CGST+SGST or IGST by place of supply, sequential numbering), credit notes for returns, a GST report export. Rates and the per-piece threshold are settings the CA can change. Until the GSTIN is active the store runs with `gst.enabled = false` and must not take real orders.
- **Consumer Protection (E-Commerce) Rules, 2020:** legal name, address and contact details shown on the site; a named grievance officer; complaints acknowledged within 48 hours and resolved within one month (the ticket system tracks both clocks); no pre-ticked consent boxes; accurate "was" prices; no fake urgency.
- **Data protection (DPDP):** consent banner with separate analytics and marketing choices; consent records with timestamp and notice version; withdrawal as easy as consent; privacy notice; self-serve data export and deletion; no marketing messages without a separate opt-in.
- **Platform rules:** Razorpay and Shiprocket KYC; WhatsApp template approval by Meta; the public site must show shipping, contact, pricing, terms, privacy and cancellation/refund pages before payment live keys are issued.

## Success criteria
- A first-time visitor can go from landing to a paid or COD order in under five steps, including OTP.
- No order is ever marked paid without a verified Razorpay signature or a verified webhook; no duplicate orders from retries; stock never goes negative.
- Every item in the **no-code list** below can be changed by the owner from the admin, on a phone, with no deploy.
- Product listing LCP under 2.5 s, CLS under 0.1, INP under 200 ms on a mid-range phone.
- Prepaid share of orders above the owner's target; RTO rate tracked per campaign and per pincode.
- Admin can publish a new product in under two minutes from a phone.

### No-code list (acceptance test for the owner)
Prices and compare-at prices; sale schedules; coupons, automatic offers and combos; categories, sizes, colors and collections; homepage sections, banners and navigation; policy pages, FAQs and journal; shipping charge and free-shipping threshold; COD on/off, limit and fee; prepaid discount; GST rates and HSN; return window; low-stock threshold; message templates and automations; staff and roles; SEO titles and descriptions; AI-crawler toggle; maintenance mode.

## Open decisions (need an answer before the milestone that depends on them)
| Decision | Needed by | Owner of the decision |
|---|---|---|
| Return and exchange window; who pays return shipping; refund timeline | M4 | Owner |
| Shipping model: flat or by weight/zone/state; free-shipping threshold; delivery estimates | M3 | Owner |
| COD limits (max value), COD fee (if any), prepaid discount size, who confirms COD orders | M3 | Owner |
| Colors as a variant dimension (the schema supports it) and SKU scheme | M3 | Owner |
| GST treatment of bundle discount allocation, COD fee, shipping, gift cards and loyalty credit; invoice number format; credit notes | M3 | CA |
| Is a packing-only role needed in addition to Staff? | M5 | Owner |
| Wallet expiry period and loyalty earn rate | M6 | Owner |
| WhatsApp authentication template deliverability to +91 numbers (test with a real number) | M2 | Developer |

## Key risks
- Paperwork lead times (GSTIN, Razorpay and Shiprocket KYC, Meta business verification) set the launch date, not engineering.
- OTP abuse and SMS/WhatsApp pumping: mitigated by CAPTCHA, shared rate limits and daily send caps.
- RTO losses on COD: mitigated by COD limits, confirmation, pincode checks and per-campaign RTO reporting.
- Stacked offers eroding margin: mitigated by the global discount cap and optional cost-price floor.
- Scope size: mitigated by milestone checkpoints, staging reviews and feature flags.
