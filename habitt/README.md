# Habitt

Minimalist clothing e-commerce store with Razorpay checkout and an admin panel.
Built to spec from `docs/PRD.md`, `docs/AppFlow.md`, `docs/Design.md`, `docs/Schema.md`,
`docs/TechSpec.md`, `docs/ImplementationPlan.md` — read those first, they live in `/docs`.

## Project Structure & Setup
> **Note**: This repo contains a nested Next.js project directory at `habitt/habitt` where `package.json` resides. All commands must be executed inside `habitt/habitt`.

```bash
cd habitt                   # Navigate into the Next.js project subfolder
npm install
cp .env.example .env        # Fill in Supabase + NextAuth values (Razorpay keys optional for dev)
npx prisma db push          # Syncs prisma/schema.prisma to your Supabase DB
npx prisma db seed          # Creates a sample admin user (admin@habitt.in / admin123) + 3 products
npm run dev
```

## Environment Variables
The following environment variables are referenced across the codebase (`lib/`, `app/`, `prisma/`):

- **Database**:
  - `DATABASE_URL`: Transaction-pooled Postgres connection string (e.g. `postgresql://...:6543/postgres?pgbouncer=true`).
  - `DIRECT_URL`: Direct Postgres connection string (e.g. `postgresql://...:5432/postgres`).
- **Auth**:
  - `AUTH_SECRET` or `NEXTAUTH_SECRET`: Secret used by NextAuth to sign JWT tokens.
  - `NEXTAUTH_URL`: Canonical site URL (defaults to `http://localhost:3000`).
- **Supabase Storage**:
  - `SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_URL`: Supabase project URL.
  - `SUPABASE_SERVICE_ROLE_KEY`: Service role secret key (server-only for admin image uploads).
  - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: Public publishable key for client-side Supabase calls.
- **Payments (Razorpay)**:
  - `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `NEXT_PUBLIC_RAZORPAY_KEY_ID`.
  - *Note for local development*: `lib/razorpay.ts` instantiates Razorpay lazily inside route handlers, so Razorpay environment variables can remain empty during local development until actual checkout testing.
- **Email**:
  - `RESEND_API_KEY`: API key for Resend email notifications.

## Database & Seeding
Run `npx prisma db push` to push the schema to Supabase, then `npx prisma db seed` to seed initial data.
The seed script generates an initial owner account:
- **Email**: `admin@habitt.in`
- **Password**: `admin123` (hashed with `bcryptjs`)
- **Role**: `OWNER`

## Implementation Progress
See `docs/ImplementationPlan.md` for current phase statuses.
