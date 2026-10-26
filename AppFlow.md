# AppFlow — Habitt

## Header (every page)
Three columns: left nav (`shop` / `journal` / `about`), centered icon + lowercase wordmark linking home, right nav (`search` / `wishlist` / `admin` *(staff only)* / `account` / `cart`). Nav items are owner-editable (`NavLink`). `admin` renders only for `STAFF`/`OWNER` sessions. `account` opens the sign-in sheet when signed out and `/account` when signed in. The cart shows a small solid dot (not a number) when non-empty. An optional announcement bar sits above the header (`Banner`).

## Identity flows

### Guest to customer (at checkout)
```
Browse / search / wishlist / cart  — no account needed (cart lives in the browser)
 └─ "Checkout" (from cart drawer or /checkout)
      ├─ signed in already → straight to address step
      └─ signed out → Sign-in sheet (bottom sheet on mobile, dialog on desktop)
           ├─ enter phone (default) OR choose "use email instead"
           ├─ CAPTCHA (invisible) → "Send code"
           │    ├─ phone → code sent on WhatsApp
           │    │    └─ not on WhatsApp / send fails → offered "Send to email instead"
           │    └─ email → code sent by email
           ├─ enter 6-digit code (paste supported; auto-submits at 6 digits)
           │    ├─ wrong code → inline error, attempts counted (max 5)
           │    ├─ expired → "Send a new code" (30 s resend cooldown)
           │    └─ correct → session created (long-lived), cart synced to server, sheet closes
           └─ new user → account created silently (name collected on the address step)
```
Returning customers on a known device never see the sheet. A new device or cleared browser data costs one OTP. Customers can sign out manually or "sign out of all devices" from `/account`.

### Step-up verification (customers)
Changing the phone number or email on an account requires a fresh OTP to the *new* identifier (and to the old one if it is verified).

### Staff and owner
```
/admin/login  — email only → OTP by email (address must be on the owner's allowlist)
 └─ session: 7 days sliding, 30 days absolute; new device → email alert to the owner
Step-up (fresh OTP within the last 10 minutes) required for:
  refunds · changing settings (GST, shipping, COD, payments) · staff and role changes ·
  data exports · deleting or voiding offers/gift cards · wallet adjustments
```
Unknown emails get the same neutral response ("If this address is allowed, a code is on its way") so allowlist membership is not revealed.

## Storefront

```
Home (/)
 ├─ announcement bar (optional)
 ├─ sections from admin: hero, collection rows, banners, text blocks
 └─ product cards → Product Detail

Shop (/shop) and category/collection pages (/shop/[category], /collections/[slug])
 ├─ filters: size, color, price, in stock · sort: newest, price low/high
 ├─ pagination (24 per page)
 └─ search overlay (/search?q=) with typo tolerance; "no results" suggestions; empty-result queries are logged for the owner

Product Detail (/product/[slug])
 ├─ gallery with zoom and swipe; color switch changes images
 ├─ size selector: out-of-stock sizes struck through; low-stock message only when true
 ├─ "Notify me" for a sold-out size (asks for WhatsApp/email, consent-aware)
 ├─ size chart, fit notes, size recommender (height + weight)
 ├─ price: selling price, struck-through compare-at price, active offer badge ("2 for ₹3,999")
 ├─ pincode check: serviceability, COD availability, delivery estimate
 ├─ fabric, care, FAQ, reviews (verified buyers), "complete the look", recently viewed
 ├─ wishlist heart · share on WhatsApp
 └─ mobile: sticky "ADD TO BAG" bar above the safe area

Cart Drawer (every page)
 ├─ line items with thumbnail, size/color, qty stepper (capped at stock), remove with Undo toast
 ├─ itemised savings: sale price, each automatic offer, coupon (if any)
 ├─ nudges: free-shipping progress, "add 1 more for the combo price"
 ├─ coupon field → coupon-vs-automatic comparison message (see Offers)
 ├─ drawer is back-button aware (Android back closes it) and swipe-to-dismiss
 └─ "Checkout"
```

## Checkout (`/checkout`, dedicated page)
```
Step 1 · Contact        — signed-in identity shown; phone required (for courier), email optional (for invoice)
Step 2 · Address        — saved addresses or new; pincode autofills city/state; optional business GSTIN
Step 3 · Delivery & pay — shipping line; payment choice:
                            ● Pay online (UPI / cards / netbanking / wallets)  "save ₹X"
                            ○ Cash on delivery  (+ COD fee, shown here, not later)  — only if eligible
                          wallet credit toggle ("Use ₹X from wallet")
                          unticked, separate opt-in boxes for email / WhatsApp offers
Step 4 · Review         — full price breakdown, tax included note, "Pay ₹X" or "Place order"
```
COD is hidden or explained when ineligible: pincode not serviceable for COD, cart above the owner's COD limit, customer flagged `codBlocked`, or too many pending COD orders.

## Pricing evaluation order (same function in cart preview and at order creation)
1. Sale prices (compare-at → selling price) per line.
2. Automatic item and collection offers and combos, in owner priority order; percent offers apply to the price left after earlier discounts. Items already discounted are skipped by offers marked "exclude discounted".
3. Cart-level automatic offers (spend tiers, free shipping, gift with purchase).
4. **Coupon (exclusive):** compared with the automatic total; the customer gets the better of the two and is told ("SAVE10 would save ₹498, but your automatic offers save ₹981, so we kept those").
5. Global discount cap and optional cost-price floor trim anything excessive.
6. Prepaid discount (if paying online; stacks by default).
7. Shipping fee and COD fee.
8. GST extracted per line from the discounted GST-inclusive value; invoice breakup computed.
9. Wallet credit applied last as a payment tender (it reduces the amount due, not the taxable value).
Discounts are allocated to lines with largest-remainder rounding so lines always sum to the order totals.

## Prepaid payment flow (server-authoritative)
1. Customer taps **Pay**; the client sends the cart, address, payment method and a client-generated **idempotency key**.
2. `POST /api/checkout/create-order` validates input, re-prices on the server from the database (only `ACTIVE` products, integer quantities 1–10, duplicate lines merged), creates the local `Order` (`paymentStatus = PENDING`, `fulfilmentStatus = CREATED`) and a Razorpay order. The same key returns the same order. If the amount is unchanged on retry, the existing Razorpay order is reused.
3. Client opens Razorpay Checkout with the returned order id.
4. Success → client posts the three Razorpay values to `/api/checkout/verify`, which re-verifies the HMAC signature, confirms the order belongs to the signed-in user, and calls `markOrderPaid` (the **only** place an order becomes paid). That function updates status, decrements stock with a guarded query, writes `StockMovement`, allocates the invoice number and queues messages and server-side ad events, all in one transaction.
5. The Razorpay webhook is the independent second path (browser closed, network drop). Events are de-duplicated by event id. `payment.failed` marks a still-pending order `FAILED`.
6. Failure or dismissal → back to checkout, cart preserved, clear retry button, no duplicate order.
7. A scheduled cleanup closes stale `PENDING` orders so they never appear as real orders.

## COD flow
```
Place order (COD) → order PLACED, paymentStatus COD_PENDING, stock decremented at placement
 ├─ customer gets "order received" on WhatsApp/email
 ├─ if confirmation is required:
 │     WhatsApp message with a confirm link/button → customer confirms → CONFIRMED
 │     no reply within the owner's window → appears in admin "COD to confirm" → staff calls/WhatsApps → confirm or cancel (restock)
 ├─ CONFIRMED → PACKED → SHIPPED (Shiprocket AWB, COD amount set)
 ├─ DELIVERED → COD_COLLECTED (courier collects cash; remittance tracked until `codRemittedAt`)
 └─ refused/undeliverable → RTO → stock returns after receipt; counted in RTO analytics; repeat offenders can be `codBlocked`
```
Server-side ad "Purchase" events fire for prepaid orders when paid and for COD orders when **confirmed**, not when merely placed.

## Order lifecycle (customer view)
```
/account/orders           list with status chips
/account/orders/[id]      timeline: placed → confirmed → packed → shipped (courier + AWB + live tracking link) → delivered
 ├─ cancel (only before shipping) → restock, refund to source or wallet
 ├─ "Return or exchange" (within the owner's window, after delivery)
 │     choose items + reason + photos; choose exchange size or refund
 │     → REQUESTED → APPROVED → pickup scheduled (Shiprocket) → RECEIVED → refund/exchange → COMPLETED (credit note issued)
 │     refund method: original payment (Razorpay refund) or **store credit** (instant; no bank details needed for COD orders)
 ├─ download invoice (PDF) and credit note
 └─ "Help with this order" → creates a support ticket tied to the order
/track  (public)          order id + phone → latest status (no login)
```

## Account (`/account`)
Orders · Addresses (add/edit/default) · Wallet (balance, entries, expiry dates, redeem gift card code) · Referrals (code, link, status) · Wishlist (move to bag) · Preferences (email/WhatsApp marketing opt-ins, consent history) · Privacy (export my data, delete my account) · Sign out / sign out of all devices.

## Rewards flows
- **Loyalty:** a reward is credited to the wallet only after an order is delivered **and** the return window has passed. Returned orders earn nothing.
- **Referral:** a friend opens a referral link, gets a first-order discount; the referrer is credited after the friend's order is delivered and past the return window. Self-referral (same phone, address, device, payment instrument) and per-referrer caps are checked.
- **Gift card:** bought as a product; the code is sent by WhatsApp/email to the recipient; entering the code in the account **moves its value into the redeemer's wallet** (one spending mechanism). Code lookups are rate-limited.
- **Refund to credit:** one tap at refund time; the owner can add a bonus percentage.
- **Influencer:** a code and tracked link attribute orders; commission is recorded per order and released after the return window; payouts are exported as CSV.

## Offers (customer-facing behaviour)
Automatic offers apply without a code. Combos show on product and cart ("2 for ₹3,999 applied"). A customer can hold only one coupon; entering a second replaces the first. Expired or exhausted offers disappear from the cart with a plain explanation, and totals are always recomputed on the server before payment.

## Support and legal
- `/contact` and the footer show the legal name, address, grievance officer, support email and phone.
- Contact/grievance form creates a ticket with a number; the customer sees it acknowledged (target: within 48 hours) and resolved (within one month). The admin inbox highlights tickets approaching either deadline.
- Policy pages (terms, privacy, refund/cancellation, shipping) are published from the admin and must exist before Razorpay's website review.

## Consent and tracking
```
First visit → consent banner: Essential (always) · Analytics · Marketing (ads)  — nothing optional fires before a choice
 ├─ UTM, click ids and landing path captured on first touch (stored against the order at checkout)
 ├─ Analytics consent → first-party funnel events
 └─ Marketing consent → Meta Pixel + server-side Conversions API (shared event id), Google conversions
Preferences page lets the customer change or withdraw any choice at any time; every change is recorded.
```
Ad landing flow: ad click → campaign landing page or `?offer=CODE` link → code auto-applied in the cart → checkout. The first touch is stored for attribution.

## Admin (protected, `/admin/*`)
```
/admin  Dashboard
 ├─ Needs attention: COD to confirm · paid orders to ship · failed payments · return requests · open tickets (deadline clocks) · low stock
 ├─ KPIs: today / 7 days / 30 days / custom range
 └─ shortcuts: new product, new offer, today's orders

/admin/orders        search (id, phone, email) · saved views · filters · bulk actions (mark shipped, labels, packing slips) · CSV export
 └─ /admin/orders/[id]  timeline, items, payment, address, notes/tags, customer contact buttons,
                        ship (courier + AWB, or Shiprocket booking), confirm/cancel COD, refund (step-up), download invoice
/admin/returns       requests → approve/reject → schedule pickup → mark received → refund/exchange
/admin/products      list (cards on phone, table on desktop) · bulk edit · CSV import/export · duplicate · scheduled publish
 └─ /new, /[id]/edit variants (size × color), images (reorder, bulk upload), compare-at/cost/HSN, SEO, stock history, stock-take
/admin/collections   manual or rule-based
/admin/offers        list with status (scheduled / active / expired) · builder · simulator · performance
/admin/customers     search · timeline (view-only) · segments · COD block · wallet adjustment (step-up)
/admin/content       homepage sections · banners · navigation · pages · FAQs · journal · preview as customer · schedule
/admin/marketing     campaign links · landing pages · link-in-bio · ad spend · attribution · message templates · automations · influencers
/admin/rewards       wallet liability · gift cards · referrals · loyalty settings · influencer payouts
/admin/reports       sales · funnel · products · coupons · RTO · COD remittance · settlements · GST export
/admin/support       tickets
/admin/settings      store identity · GST · shipping · COD · prepaid discount · offer rules · loyalty · returns · SEO · feature flags · maintenance
/admin/team          staff invites · roles · audit log · sessions
```
Layout adapts: sidebar on large screens, bottom tab bar on phones (Dashboard, Orders, Products, More). Lists are cards on phones and dense tables on desktop. Destructive or sensitive actions ask for a fresh code (step-up) and are written to the audit log.

## Notification matrix
| Event | Customer | Owner/staff |
|---|---|---|
| Login code | WhatsApp (Authentication template) or email | email (admin login) |
| Order placed / paid | WhatsApp + email (invoice link) | push + digest |
| COD confirmation request | WhatsApp (confirm link) | "COD to confirm" inbox |
| Shipped (courier + tracking) | WhatsApp + email | — |
| Out for delivery / delivered | WhatsApp | — |
| Cancelled / refund processed / credit added | WhatsApp + email | audit log |
| Payment failed (known user) | email retry link | failure-rate metric |
| Abandoned cart *(marketing, consent required, frequency-capped)* | email, WhatsApp | — |
| Back in stock *(requested by the customer)* | WhatsApp/email | — |
| Review request *(after delivery + days)* | email | — |
| Return status changes | WhatsApp + email | inbox |
| New ticket / approaching deadline | acknowledgement | push + email |
| Low stock, daily digest | — | WhatsApp or email |
| New admin device sign-in | — | email to owner |
Every transactional template has an email fallback. Marketing messages check consent and frequency caps before sending.

## Background jobs (scheduled, `/api/cron/*`, secret-protected)
Close stale pending orders · COD confirmation timeout reminders · abandoned-cart messages · release loyalty and referral rewards after the return window · expire wallet credit · Shiprocket status sync (fallback to webhooks) · retry outbox (server-side ad events, message sends) · daily digest · low-stock alert · purge old analytics events · clean expired OTP challenges and sessions.

## Empty, error and edge states
- Empty cart, empty wishlist, empty orders, no search results: helpful message plus a way forward, never a blank panel.
- Out-of-stock size: disabled with a label and a "notify me" option; stock can run out between cart and payment → clear message at checkout, offending line highlighted.
- OTP: undelivered on WhatsApp → offer email; resend cooldown; lockout message after too many attempts; neutral responses that never reveal whether an account exists.
- Offer expires or hits its limit mid-checkout → totals recalculated and the change explained before payment.
- Payment pending or unknown → "We're confirming your payment" page that polls the order and relies on the webhook; never a second charge.
- Admin deleting a product with orders → archive only; deleting a collection, offer or page asks for confirmation and offers Undo where possible.
- Maintenance mode shows a branded holding page; admin stays accessible.
