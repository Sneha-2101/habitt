# PRD — Habitt

## Problem statement
Habitt is a minimalist D2C clothing brand (shirts, overshirts, polos, trousers) inspired by Rare Rabbit's aesthetic. We need a storefront where customers can browse, buy, and pay online, plus an admin panel where the Habitt team manages products, inventory, and orders without touching code.

## Target users
- **Shoppers**: browse the catalog, add to bag, and check out. **Login is required to buy** — an account gets order history and faster future checkout, and it's also what lets a shopper's order be reliably tied to them for support/refund conversations.
- **Admin (Habitt team)**: 1–3 internal users. Add/edit/delete products, manage stock, view and update orders, see basic sales numbers.

### Unified auth
There is **one login page** for everyone (`/login`), not a separate admin login. A single `User` table holds both customers and staff, distinguished only by `role` (`CUSTOMER`, `STAFF`, `OWNER`). Signing in as staff doesn't change the storefront experience except one thing: the header shows an "admin" link. Customers never see it. `/admin` itself is also gated server-side (middleware), so it's not reachable by guessing the URL even without the link.

## Core features (MVP)
1. **Storefront**: home/hero, category browsing, product grid, product detail page (images, sizes, price, stock), search (basic).
2. **Cart & checkout**: persistent cart, guest checkout, address form, order summary.
3. **Payments**: Razorpay integration — create order server-side, open Razorpay Checkout, verify payment signature on the server, mark order paid only after verification. Support UPI, cards, netbanking, wallets (all handled by Razorpay's checkout widget).
4. **Order confirmation**: order success page, order confirmation email.
5. **Admin — products**: CRUD for products (name, description, category, price, sizes, stock per size, images, status: active/draft).
6. **Admin — orders**: list orders, filter by status (pending/paid/shipped/delivered/cancelled), update status, view customer + payment details.
7. **Admin — dashboard**: basic metrics (orders today, revenue this week, low-stock alerts).
8. **Auth**: one login (NextAuth/Auth.js credentials) for customers and staff alike. Signup creates a `CUSTOMER`; `STAFF`/`OWNER` accounts are created manually (seed script or by an existing `OWNER`) — there's no public path to becoming an admin.

## Out of scope for MVP (phase 2+)
- Customer accounts / order history / wishlists
- Discount codes, gift cards
- Multi-warehouse inventory, shipping-rate integrations (start with flat/free-above-threshold shipping)
- Reviews & ratings
- Returns/refunds workflow beyond manual admin status change

## Success criteria
- A customer can go from landing on the homepage to a successfully paid order in under 5 steps.
- No order is ever marked "Paid" without a verified Razorpay signature (webhook + server verification, not just client-side callback).
- Admin can add a new product and have it live on the storefront in under 2 minutes, no deploy needed.
- Site is fully usable on mobile (majority of D2C fashion traffic is mobile).
- Page load (LCP) under 2.5s on product listing pages.

## Key risks / decisions to lock early
- Payment verification must happen server-side via Razorpay webhook, not just the browser success callback (browser callback can be spoofed).
- Stock must be decremented atomically at order-confirmation time to avoid overselling during traffic spikes.
- Image storage/CDN choice (Supabase Storage) decided in TechSpec.md.
