# TechSpec — Habitt

## Stack
- **Frontend**: Next.js 15 (App Router), TypeScript, Tailwind CSS. Server Components for product listing/detail (fast, SEO-friendly); Client Components for cart, checkout form, admin forms.
- **Backend**: Next.js Route Handlers (`/app/api/**`) — no separate backend service needed at this scale.
- **Database**: PostgreSQL via Supabase, accessed through **Prisma** (`prisma db push` for schema sync, matching your existing workflow — add real migrations once the schema stabilizes post-launch).
- **File storage**: Supabase Storage for product images, uploaded from the admin panel. Bucket policy: public read, writes restricted to service-role key used only in server actions (never exposed client-side) — same pattern as your avatar-upload setup on the Quiz Portal.
- **Auth**: NextAuth v5 (Auth.js), credentials provider for `AdminUser`, session-based, middleware-gated on `/admin/*`. Storefront stays unauthenticated (guest checkout).
- **Payments**: Razorpay — Orders API (server) + Checkout.js (client) + Webhooks (server-to-server confirmation).
- **Email**: Resend or Supabase's built-in email for order confirmation (pick whichever you already have configured; Resend is simpler to wire into a route handler).
- **Deployment**: Vercel (frontend + API routes), Supabase (DB + storage), both free-tier-viable pre-launch.

## Environment variables
```
DATABASE_URL=
DIRECT_URL=                 # Supabase direct connection for Prisma
NEXTAUTH_SECRET=
NEXTAUTH_URL=
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=        # server only, never sent to client
RAZORPAY_WEBHOOK_SECRET=
NEXT_PUBLIC_RAZORPAY_KEY_ID=  # public key, safe for client checkout widget
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=  # server only
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
RESEND_API_KEY=
```

## Razorpay integration — key code shape

**1. Create order (server) — `app/api/checkout/create-order/route.ts`**
```ts
import Razorpay from "razorpay";
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID!,
  key_secret: process.env.RAZORPAY_KEY_SECRET!,
});

export async function POST(req: Request) {
  const { items, address } = await req.json();
  // 1. re-price items server-side from DB — never trust client-sent prices
  // 2. create local Order row, status PENDING
  const rzpOrder = await razorpay.orders.create({
    amount: totalInPaise,
    currency: "INR",
    receipt: order.displayId,
  });
  await prisma.order.update({
    where: { id: order.id },
    data: { razorpayOrderId: rzpOrder.id },
  });
  return Response.json({ razorpayOrderId: rzpOrder.id, amount: totalInPaise, orderId: order.id });
}
```

**2. Verify payment (server) — `app/api/checkout/verify/route.ts`**
```ts
import crypto from "crypto";

export async function POST(req: Request) {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = await req.json();
  const expected = crypto
    .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET!)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest("hex");

  if (expected !== razorpay_signature) {
    return Response.json({ verified: false }, { status: 400 });
  }
  // mark order PAID + decrement stock, inside a prisma.$transaction
  return Response.json({ verified: true });
}
```

**3. Webhook (independent confirmation) — `app/api/webhooks/razorpay/route.ts`**
```ts
export async function POST(req: Request) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-razorpay-signature")!;
  const expected = crypto
    .createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET!)
    .update(rawBody)
    .digest("hex");
  if (signature !== expected) return new Response("invalid", { status: 400 });

  const event = JSON.parse(rawBody);
  if (event.event === "payment.captured") {
    // idempotent: only update if order isn't already PAID
  }
  return new Response("ok");
}
```

**4. Client checkout widget**
```ts
const res = await fetch("/api/checkout/create-order", { method: "POST", body: JSON.stringify({ items, address }) });
const { razorpayOrderId, amount, orderId } = await res.json();

const rzp = new window.Razorpay({
  key: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
  amount,
  currency: "INR",
  order_id: razorpayOrderId,
  handler: async (response) => {
    await fetch("/api/checkout/verify", { method: "POST", body: JSON.stringify(response) });
    router.push(`/order/${orderId}/success`);
  },
});
rzp.open();
```
Load the Checkout script via `<Script src="https://checkout.razorpay.com/v1/checkout.js" />` (Next.js `next/script`).

## Admin auth middleware
`middleware.ts` checks the NextAuth session on any `/admin/*` route except `/admin/login`, redirecting unauthenticated requests to login. Role check (`OWNER` vs `STAFF`) enforced per-route where needed (e.g. only `OWNER` can add other admins, if that feature is added later).

## Non-functional notes
- Prices are always re-validated server-side at order-creation — the client never dictates the amount charged.
- Rate-limit `/api/checkout/create-order` (basic IP-based limiter) to reduce abuse.
- Use Next.js Image component + Supabase Storage transformed URLs for responsive product images.
