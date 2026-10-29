# Habitt

Minimalist clothing e-commerce store with Razorpay checkout, OTP-based phone authentication, and comprehensive admin dashboard.

> **IMPORTANT**: Business details (legal name, support phone, WhatsApp number, support email, pickup location, return/shipping rules) are edited dynamically in `/admin/settings`. **Never hardcode business details** in source code or template pages.

---

## Getting Started & Setup

### Prerequisites
- Node.js 20 or 22
- PostgreSQL database (Supabase recommended with transaction pooler + direct session connection)

### Installation
```bash
# Clone the repository and install dependencies
npm install

# Copy environment template
cp .env.example .env
```

### Database Setup & Migrations
Always run Prisma migrations using the project script:
```bash
npm run db:migrate
```
*(Do not use `prisma db push` or `prisma migrate reset` in production or shared environments).*

To seed initial store data:
```bash
npx prisma db seed
```

To start the local development server:
```bash
npm run dev
```

---

## Testing

The project uses [Vitest](https://vitest.dev/) for testing:

### Unit Tests
Unit tests run fast in-memory checks (shipping logic, business detail guard, pricing math):
```bash
npm test
# Equivalent to: npx vitest run tests/unit
```

### Integration Tests
Integration tests test end-to-end API routes, database state, order flows, and rate limiting:
```bash
npm run test:integration
# Equivalent to: npx vitest run tests/integration
```

---

## Environment Variables

See [.env.example](file:///.env.example) for the full annotated list of environment variables. Key variable categories:

- **Database**:
  - `DATABASE_URL`: Transaction-pooled connection string (port 6543 on Supabase) used by Prisma Client.
  - `DIRECT_URL`: Direct connection string (port 5432) used for running `npm run db:migrate`.
- **Auth & Security**:
  - `AUTH_SECRET` / `NEXTAUTH_SECRET`: Secret key for session encryption.
  - `OTP_PEPPER`: Secret pepper for HMAC-SHA256 OTP hashing in database.
  - `OTP_DAILY_CAP`: Maximum global OTP sends per UTC day (default: 300).
- **Bot Protection & Rate Limiting**:
  - `NEXT_PUBLIC_TURNSTILE_SITE_KEY` & `TURNSTILE_SECRET_KEY`: Cloudflare Turnstile keys.
  - `UPSTASH_REDIS_REST_URL` & `UPSTASH_REDIS_REST_TOKEN`: Upstash Redis instance for sliding window rate limits. (Falls back to memory in development).
- **Payments**:
  - `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `NEXT_PUBLIC_RAZORPAY_KEY_ID`: Razorpay credentials (must use `rzp_test_` in dev/staging).
  - `RAZORPAY_WEBHOOK_SECRET`: Secret to verify incoming payment webhooks.
- **Logistics**:
  - `SHIPROCKET_EMAIL`, `SHIPROCKET_PASSWORD`, `SHIPROCKET_PICKUP_LOCATION`.
- **Cron Jobs**:
  - `CRON_SECRET`: Bearer token authorizing automated scheduled jobs.

---

## Cron Endpoints & Schedules

All cron endpoints require the `Authorization: Bearer <CRON_SECRET>` header.

| Endpoint | Purpose | Recommended Schedule | Description |
| :--- | :--- | :--- | :--- |
| `GET /api/cron/close-stale-orders` | Order timeout | `*/30 * * * *` (Every 30m) | Closes `PENDING` Razorpay orders older than 2 hours and restores inventory. |
| `GET /api/cron/abandoned-cart` | Abandoned recovery | `0 * * * *` (Hourly) | Sends reminder email for unpaid carts based on `abandonedCartDelayHours`. |
| `GET /api/cron/birthday-discount` | Birthday rewards | `0 9 * * *` (Daily 09:00 UTC) | Creates unique birthday coupon codes and notifies registered customers. |

---

## Health & Monitoring

- `GET /api/health`: Returns `{ ok: true }` (HTTP 200) when the database is connected (`SELECT 1`), or `{ ok: false }` (HTTP 503) on error. Suitable for uptime probes and load balancer health checks.
