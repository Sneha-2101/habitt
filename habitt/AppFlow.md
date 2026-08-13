# AppFlow — Habitt

## Header (every page)
Three columns, matching the reference layout: left nav (`shop` / `journal` / `about`), centered
icon + wordmark linking home, right nav (`search` / `admin` *(staff only)* / `account` / `cart`).
The `admin` link only renders when the session role is `STAFF` or `OWNER` — customers and
logged-out visitors never see it. `account` links to `/login` when logged out, `/account` when
logged in.

## Auth (shared by everyone)

```
/login   — email + password, works for customers and staff alike
 └─ on success → redirect to ?redirect= param, or home

/signup  — creates a CUSTOMER account (staff accounts aren't self-serve)
 └─ on success → /login
```

## Storefront

```
Home (/)
 ├─ Hero + featured categories + featured products
 ├─ Shop All (/shop)
 │   ├─ filter by category, sort by price
 │   └─ Product card → Product Detail (/product/[slug])
 │        ├─ image gallery, size selector, add to bag
 │        └─ "Add to bag" → opens Cart Drawer (no page nav)
 ├─ Cart Drawer (slide-over, available on every page)
 │   └─ "Checkout" → /checkout
 │        └─ if logged out → redirected to /login?redirect=/checkout first
 ├─ Checkout (/checkout) — requires login
 │   ├─ Step 1: contact + shipping address (name/email prefilled from account)
 │   ├─ Step 2: order review
 │   └─ Step 3: "Pay with Razorpay" → Razorpay Checkout modal
 │        ├─ success → POST /api/checkout/verify → /order/[id]/success
 │        └─ failure → back to checkout with error, cart preserved
 ├─ Order Success (/order/[id]/success)
 │    └─ order id, summary, "confirmation emailed to you"
 └─ Account (/account) — requires login
      └─ order history, sign out
```

## Admin (protected, /admin/*)
No separate login — signing in at `/login` with a STAFF/OWNER account is what unlocks this.
`/admin` is reachable only by URL (or the header's `admin` link, which only staff ever see);
middleware redirects anyone else to `/` (if logged in as a customer) or `/login` (if logged out).

```
/admin (dashboard)
 ├─ today's orders, revenue this week, low-stock list

/admin/products
 ├─ table: name, category, price, stock, status
 ├─ /admin/products/new → form → save → back to list
 └─ /admin/products/[id]/edit → form (prefilled) → save/delete

/admin/orders
 ├─ table: order id, customer, total, payment status, order status
 ├─ filter by status
 └─ /admin/orders/[id] → detail, update status (Paid → Shipped → Delivered)
```

## Payment flow (server-authoritative)
1. Customer clicks "Pay" on `/checkout` → client calls `POST /api/checkout/create-order`.
2. Server creates a local `Order` (status: `pending`) + a Razorpay Order via Razorpay's Orders API, returns `razorpay_order_id` to client.
3. Client opens Razorpay Checkout widget with that order id.
4. On success, Razorpay returns `razorpay_payment_id`, `razorpay_order_id`, `razorpay_signature` to the client, which POSTs them to `/api/checkout/verify`.
5. Server re-verifies the signature using the Razorpay secret (HMAC check) — **this is the only place an order is marked `paid`**.
6. Razorpay webhook (`/api/webhooks/razorpay`) is also configured as a second, independent confirmation path in case the client never calls back (browser closed, network drop) — this is what makes payment status trustworthy.
7. Stock is decremented inside the same transaction that marks the order paid.

## Empty / error states worth designing up front
- Empty cart → "Your bag is empty" + link back to shop, not a blank drawer.
- Out-of-stock size → disabled with "Out of stock" label, not just hidden.
- Payment failed → clear retry CTA, cart items preserved, no duplicate order created on retry.
- Admin: deleting a product that has past orders → soft-delete (status: archived), never hard-delete, so order history stays intact.
