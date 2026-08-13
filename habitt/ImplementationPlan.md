# Implementation Plan — Habitt

## Status Summary
- **Phase 0 — Setup**: Completed (Next.js 15, Prisma, Supabase DB & Storage configured).
- **Phase 1 — Storefront core**: Completed (Home, Shop, Product Detail, Cart Drawer, CareTag aesthetic, responsive grid).
- **Phase 2 — Checkout & payments**: Code-complete & reviewed (server-side re-pricing, idempotent transaction retry, ownership/status checks, webhook/verification handlers). **Pending end-to-end testing** until test-mode Razorpay keys are configured.
- **Phase 3 — Admin panel**: Completed (Products CRUD, Supabase Storage image upload/delete, Orders table & status updates, Dashboard overview).
- **Phase 4 — Hardening & polish**: Completed (bcryptjs password hashing, mobile responsiveness pass, empty cart CTA, out-of-stock size disabling, soft-delete archiving).

---

## Phase Details

### Phase 0 — Discovery & setup (COMPLETED)
- Confirm scope against PRD.md (lock MVP feature list).
- Create Supabase project (DB + Storage bucket `product-images`).
- Scaffold Next.js 15 + TypeScript + Tailwind + Prisma repo, connect to Supabase via `prisma db push` using Schema.md.

### Phase 1 — Storefront core (COMPLETED)
- Home page, Shop page with category filter, Product detail page — Server Components pulling from Prisma.
- Cart drawer with Zustand client state (`lib/cart-store.ts`).
- Design system tokens in Tailwind theme config; visual language ported from `habitt_prototype.jsx`.

### Phase 2 — Checkout & payments (CODE-COMPLETE, TESTING PENDING)
- Checkout page (address form + order review).
- `/api/checkout/create-order`, `/api/checkout/verify`, `/api/webhooks/razorpay` implemented per TechSpec.md.
- Re-pricing server-side from DB, idempotent retry transaction deleting/recreating line items on cart modification, order status validation.
- *Status*: Code review complete. End-to-end Razorpay test mode verification pending key configuration.

### Phase 3 — Admin panel (COMPLETED)
- NextAuth credentials login, middleware-gated `/admin/*`.
- Products: list, create, edit (with image upload to Supabase Storage), soft-delete archiving.
- Orders: list, filter by status, detail view, manual status update (Paid → Shipped → Delivered).
- Dashboard: orders today, revenue this week, low-stock list (variant stock < threshold).

### Phase 4 — Hardening & launch prep (COMPLETED)
- `bcryptjs` password hashing implemented in NextAuth authorize, user signup action, and seed script.
- Mobile responsiveness pass across storefront, cart drawer, checkout, and admin tables (single-column mobile product grids).
- Empty & error states (empty cart CTA, out-of-stock size strike-through disabling, checkout payment error alerts, soft-delete order history preservation).

### Phase 5 — Launch
- Deploy to Vercel, connect custom domain.
- Seed real product catalog + images (replace mock data).
- Soft launch to a small audience before wider promotion.
