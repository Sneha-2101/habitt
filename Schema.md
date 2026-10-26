# Schema — Habitt (Prisma / PostgreSQL via Supabase)

> **Status:** target schema for the full launch scope (milestones M1–M7 in `ImplementationPlan.md`).
> Every model below passes Prisma 5 validation. Models are introduced **milestone by milestone** —
> an Angy prompt only adds the models listed for its milestone; it never creates the whole file at once.
> The `generator` and `datasource` blocks stay as they are in `prisma/schema.prisma`.

## Conventions
- **Money is always an integer in paise.** Never floats. Catalog prices are **GST-inclusive** selling prices.
- **Phone** is stored in E.164 (`+919876543210`). **Email** is stored trimmed and lowercase. Either may be null, but at least one must exist and be verified for a customer to log in.
- Ids are `cuid()` strings. Public-facing numbers (`Order.displayId`, `Ticket.number`, invoice numbers) are separate from internal ids.
- **Snapshots, not joins, on orders.** `OrderItem` copies name, size, color, sku, hsn, price and tax at purchase time so later edits never change history.
- Logging tables (`AuditLog`, `AnalyticsEvent`, `MessageLog`, `ConsentRecord`, `AttributionTouch`) keep plain `userId` strings with no foreign key, so deleting a user never breaks or cascades into audit history.
- Hard deletes are forbidden for anything referenced by an order. Products are archived, never deleted.
- Raw OTP codes and raw identifiers are never stored in `OtpChallenge`; only keyed hashes.

## Milestone map (which models land when)
| Milestone | Schema work |
|---|---|
| **M1 Foundation** | Replace `Order.status` with `paymentStatus` + `fulfilmentStatus`; add `paymentMethod`, `idempotencyKey`; add `ProcessedWebhook`, `StockMovement`; manual migration adding `CHECK (stock >= 0)` on `ProductVariant`; move from `db push` to Prisma migrations |
| **M2 Identity** | `User` changes (nullable email/phone, verified timestamps, status, `codBlocked`, `referralCode`), `Session`, `OtpChallenge`, `Address`, `AuditLog`, minimal `Setting` |
| **M3 Pricing & checkout** | `Category` table, `Product` extra fields, `ProductVariant` color/sku, `Cart`/`CartItem`, `Offer`, `OfferRedemption`, `OrderDiscount`, `OrderItem` tax and discount fields, `Order` breakdown fields, `GstRule`, `Invoice`, `CreditNote`, `InvoiceCounter`, `ConsentRecord` |
| **M4 Fulfilment & messages** | `Shipment`, `ShipmentEvent`, `Return`, `ReturnItem`, `Refund`, `MessageTemplate`, `MessageLog`, `Ticket`, `TicketMessage`, `EventOutbox` |
| **M5 Owner admin** | full `Setting` usage, `Page`, `Article`, `HomeSection`, `Banner`, `NavLink`, `Faq`, `Collection`, `CollectionProduct`, `SavedView`, `Segment`, `PushSubscription` |
| **M6 Rewards** | `Wallet`, `WalletEntry`, `GiftCard`, `Referral`, `Influencer`, `InfluencerCommission` |
| **M7 Storefront & growth** | `WishlistItem`, `Review`, `StockNotifyRequest`, `AttributionTouch`, `AnalyticsEvent`, `AdSpend`, `ProductImage.blurDataURL` population |

## Target schema

```prisma
// ───────────────────────── Enums ─────────────────────────
enum Role {
  CUSTOMER
  STAFF
  OWNER
}
enum UserStatus {
  ACTIVE
  INVITED
  DISABLED
}
enum ProductStatus {
  DRAFT
  ACTIVE
  ARCHIVED
}
enum PaymentMethod {
  PREPAID
  COD
}
enum PaymentStatus {
  PENDING
  PAID
  FAILED
  COD_PENDING
  COD_COLLECTED
  PARTIALLY_REFUNDED
  REFUNDED
}
enum FulfilmentStatus {
  CREATED
  PLACED
  CONFIRMED
  PACKED
  SHIPPED
  DELIVERED
  CANCELLED
  RTO
}
enum OtpChannel {
  WHATSAPP
  EMAIL
}
enum OtpPurpose {
  LOGIN
  STEP_UP
  VERIFY_CONTACT
}
enum OfferKind {
  COUPON
  AUTOMATIC
}
enum OfferType {
  PERCENT_OFF
  FLAT_OFF
  FREE_SHIPPING
  BUNDLE_FIXED_PRICE
  BUY_X_GET_Y
  QUANTITY_TIER
  SPEND_TIER
  GIFT_WITH_PURCHASE
}
enum WalletEntryType {
  LOYALTY_REWARD
  REFERRAL_REWARD
  GIFT_CARD_REDEEM
  REFUND_CREDIT
  ADMIN_ADJUSTMENT
  REDEMPTION
  EXPIRY
  REVERSAL
}
enum GiftCardStatus {
  ACTIVE
  REDEEMED
  EXPIRED
  VOID
}
enum ReferralStatus {
  PENDING
  REWARDED
  VOID
}
enum CommissionStatus {
  PENDING
  APPROVED
  PAID
  VOID
}
enum ReturnType {
  RETURN
  EXCHANGE
}
enum ReturnStatus {
  REQUESTED
  APPROVED
  PICKUP_SCHEDULED
  RECEIVED
  REJECTED
  COMPLETED
}
enum RefundMethod {
  SOURCE
  WALLET
}
enum RefundStatus {
  PENDING
  PROCESSED
  FAILED
}
enum ShipmentStatus {
  CREATED
  PICKED_UP
  IN_TRANSIT
  OUT_FOR_DELIVERY
  DELIVERED
  RTO_IN_TRANSIT
  RTO_DELIVERED
  CANCELLED
}
enum StockReason {
  SALE
  COD_PLACED
  CANCEL
  RETURN
  RTO
  MANUAL_ADJUST
  STOCK_TAKE
  OVERSOLD
}
enum ReviewStatus {
  PENDING
  APPROVED
  HIDDEN
}
enum TicketStatus {
  OPEN
  ACKNOWLEDGED
  RESOLVED
}
enum MessageChannel {
  WHATSAPP
  EMAIL
}
enum MessageKind {
  TRANSACTIONAL
  MARKETING
}
enum ConsentPurpose {
  ANALYTICS
  ADS
  EMAIL_MARKETING
  WHATSAPP_MARKETING
}
enum PageStatus {
  DRAFT
  PUBLISHED
}
enum InvoiceKind {
  TAX_INVOICE
  RECEIPT
}

// ───────────────────── Identity (M1–M2) ─────────────────────
model User {
  id              String     @id @default(cuid())
  email           String?    @unique // stored lowercase + trimmed
  phone           String?    @unique // E.164, e.g. +919876543210
  emailVerifiedAt DateTime?
  phoneVerifiedAt DateTime?
  name            String?
  role            Role       @default(CUSTOMER)
  status          UserStatus @default(ACTIVE)
  codBlocked      Boolean    @default(false)
  referralCode    String?    @unique
  passwordHash    String?    // legacy until M2 removes password login; never used for new users
  createdAt       DateTime   @default(now())

  sessions          Session[]
  addresses         Address[]
  orders            Order[]
  cart              Cart?
  wallet            Wallet?
  wishlist          WishlistItem[]
  reviews           Review[]
  tickets           Ticket[]
  returns           Return[]
  notifyRequests    StockNotifyRequest[]
  pushSubscriptions PushSubscription[]
  savedViews        SavedView[]
  referralsMade     Referral[] @relation("ReferralsMade")
  referralReceived  Referral?  @relation("ReferralReceived")
}

model Session {
  id          String    @id @default(cuid())
  user        User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  userId      String
  deviceLabel String?
  ipHash      String?
  createdAt   DateTime  @default(now())
  lastSeenAt  DateTime  @default(now())
  expiresAt   DateTime
  revokedAt   DateTime?

  @@index([userId])
}

model OtpChallenge {
  id             String     @id @default(cuid())
  channel        OtpChannel
  purpose        OtpPurpose @default(LOGIN)
  identifierHash String     // HMAC of normalized phone/email — never store the raw identifier here
  codeHash       String     // HMAC of the 6-digit code
  expiresAt      DateTime
  attempts       Int        @default(0)
  consumedAt     DateTime?
  ipHash         String?
  createdAt      DateTime   @default(now())

  @@index([identifierHash, createdAt])
}

model Address {
  id        String  @id @default(cuid())
  user      User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  userId    String
  label     String?
  name      String
  phone     String
  line1     String
  line2     String?
  landmark  String?
  city      String
  state     String
  pincode   String
  isDefault Boolean @default(false)

  @@index([userId])
}

// ───────────────────── Catalog (M1, M3, M5) ─────────────────────
model Category {
  id       String    @id @default(cuid())
  name     String
  slug     String    @unique
  position Int       @default(0)
  sizeSet  String[]  // e.g. ["S","M","L","XL"] — owner-editable
  active   Boolean   @default(true)
  products Product[]
}

model Product {
  id             String        @id @default(cuid())
  name           String
  slug           String        @unique
  description    String
  category       Category      @relation(fields: [categoryId], references: [id])
  categoryId     String
  price          Int           // paise, GST-inclusive selling price
  compareAtPrice Int?          // paise, original/MRP shown struck-through
  costPrice      Int?          // paise, admin-only, for margin guard and profit report
  hsn            String?
  fabric         String?
  fit            String?
  care           String?
  sizeChartUrl   String?
  seoTitle       String?
  seoDescription String?
  status         ProductStatus @default(DRAFT)
  publishAt      DateTime?
  createdAt      DateTime      @default(now())
  updatedAt      DateTime      @updatedAt

  images      ProductImage[]
  variants    ProductVariant[]
  collections CollectionProduct[]
  reviews     Review[]
  wishlisted  WishlistItem[]

  @@index([status, categoryId])
}

model ProductImage {
  id          String  @id @default(cuid())
  product     Product @relation(fields: [productId], references: [id], onDelete: Cascade)
  productId   String
  url         String
  alt         String?
  color       String? // optional link to a color variant
  blurDataURL String? // tiny placeholder generated at upload
  position    Int     @default(0)
}

model ProductVariant {
  id        String  @id @default(cuid())
  product   Product @relation(fields: [productId], references: [id], onDelete: Cascade)
  productId String
  size      String
  color     String  @default("")
  sku       String? @unique
  stock     Int     @default(0) // DB CHECK (stock >= 0) added in a manual migration

  cartItems      CartItem[]
  stockMovements StockMovement[]
  notifyRequests StockNotifyRequest[]

  @@unique([productId, size, color])
}

model Collection {
  id          String  @id @default(cuid())
  name        String
  slug        String  @unique
  description String?
  isAutomatic Boolean @default(false)
  ruleJson    Json?
  position    Int     @default(0)

  products CollectionProduct[]
}

model CollectionProduct {
  collection   Collection @relation(fields: [collectionId], references: [id], onDelete: Cascade)
  collectionId String
  product      Product    @relation(fields: [productId], references: [id], onDelete: Cascade)
  productId    String
  position     Int        @default(0)

  @@id([collectionId, productId])
}

model StockMovement {
  id        String         @id @default(cuid())
  variant   ProductVariant @relation(fields: [variantId], references: [id])
  variantId String
  delta     Int
  reason    StockReason
  refType   String?
  refId     String?
  actorId   String?
  createdAt DateTime       @default(now())

  @@index([variantId, createdAt])
}

// ───────────────────── Cart & orders (M1, M3) ─────────────────────
model Cart {
  id                 String     @id @default(cuid())
  user               User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  userId             String     @unique
  updatedAt          DateTime   @updatedAt
  abandonedNotifiedAt DateTime?
  items              CartItem[]
}

model CartItem {
  id        String         @id @default(cuid())
  cart      Cart           @relation(fields: [cartId], references: [id], onDelete: Cascade)
  cartId    String
  variant   ProductVariant @relation(fields: [variantId], references: [id], onDelete: Cascade)
  variantId String
  qty       Int

  @@unique([cartId, variantId])
}

model Order {
  id                String           @id @default(cuid())
  displayId         String           @unique // e.g. HB-482913
  idempotencyKey    String?          @unique
  user              User             @relation(fields: [userId], references: [id])
  userId            String
  customerName      String
  customerPhone     String
  customerEmail     String?
  shippingAddress   Json
  buyerGstin        String?
  items             OrderItem[]
  // All money in paise. total = what the customer actually pays (after every discount and wallet use).
  subtotal          Int              // sum of unit price x qty before discounts
  discountTotal     Int              @default(0)
  prepaidDiscount   Int              @default(0)
  shippingFee       Int              @default(0)
  codFee            Int              @default(0)
  walletUsed        Int              @default(0)
  total             Int
  taxableTotal      Int              @default(0)
  cgst              Int              @default(0)
  sgst              Int              @default(0)
  igst              Int              @default(0)
  paymentMethod     PaymentMethod    @default(PREPAID)
  paymentStatus     PaymentStatus    @default(PENDING)
  fulfilmentStatus  FulfilmentStatus @default(CREATED)
  razorpayOrderId   String?          @unique
  razorpayPaymentId String?
  paidAt            DateTime?
  confirmedAt       DateTime?
  cancelledAt       DateTime?
  cancelReason      String?
  attribution       Json?            // utm_*, fbclid, landing path, influencer/referral code
  createdAt         DateTime         @default(now())
  updatedAt         DateTime         @updatedAt

  discounts   OrderDiscount[]
  invoice     Invoice?
  shipments   Shipment[]
  returns     Return[]
  refunds     Refund[]
  commissions InfluencerCommission[]

  @@index([userId, createdAt])
  @@index([paymentStatus, fulfilmentStatus, createdAt])
}

model OrderItem {
  id                String  @id @default(cuid())
  order             Order   @relation(fields: [orderId], references: [id], onDelete: Cascade)
  orderId           String
  productId         String
  variantId         String
  name              String  // snapshots: later renames/repricing never change past orders
  size              String
  color             String  @default("")
  sku               String?
  hsn               String?
  unitPrice         Int
  qty               Int
  discountAllocated Int     @default(0) // this line's share of all discounts (largest-remainder rounding)
  taxableValue      Int     @default(0)
  gstRateBp         Int     @default(0) // basis points: 500 = 5%
  taxAmount         Int     @default(0)

  returnItems ReturnItem[]
}

model OrderDiscount {
  id      String  @id @default(cuid())
  order   Order   @relation(fields: [orderId], references: [id], onDelete: Cascade)
  orderId String
  offerId String?
  type    String  // OFFER | COUPON | PREPAID | LOYALTY
  label   String
  amount  Int
  detail  Json?   // per-line allocation breakdown
}

// ───────────────────── Offers, rewards (M3, M6) ─────────────────────
model Offer {
  id                String    @id @default(cuid())
  kind              OfferKind
  type              OfferType
  name              String
  code              String?   @unique // coupons only, stored uppercase
  description       String?
  config            Json      // zod-validated per type: targets, quantities, prices, percents
  priority          Int       @default(100)
  startsAt          DateTime?
  endsAt            DateTime?
  active            Boolean   @default(true)
  usageLimit        Int?
  perCustomerLimit  Int?
  minCartValue      Int?
  excludeDiscounted Boolean   @default(false)
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt

  redemptions OfferRedemption[]
  influencers Influencer[]
}

model OfferRedemption {
  id        String   @id @default(cuid())
  offer     Offer    @relation(fields: [offerId], references: [id])
  offerId   String
  userId    String
  orderId   String
  amount    Int
  createdAt DateTime @default(now())

  @@unique([offerId, orderId])
  @@index([offerId, userId])
}

model Wallet {
  id      String        @id @default(cuid())
  user    User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  userId  String        @unique
  balance Int           @default(0) // cached sum, updated in the same transaction as each entry
  entries WalletEntry[]
}

model WalletEntry {
  id        String          @id @default(cuid())
  wallet    Wallet          @relation(fields: [walletId], references: [id], onDelete: Cascade)
  walletId  String
  type      WalletEntryType
  amount    Int             // signed paise: credits positive, debits negative
  remaining Int             @default(0) // unspent part of a credit, consumed earliest-expiry first
  expiresAt DateTime?
  refType   String?
  refId     String?
  note      String?
  createdAt DateTime        @default(now())

  @@index([walletId, createdAt])
}

model GiftCard {
  id               String         @id @default(cuid())
  codeHash         String         @unique
  last4            String
  amount           Int
  status           GiftCardStatus @default(ACTIVE)
  expiresAt        DateTime?
  purchaseOrderId  String?
  recipientName    String?
  recipientContact String?
  redeemedById     String?
  redeemedAt       DateTime?
  createdAt        DateTime       @default(now())
}

model Referral {
  id         String         @id @default(cuid())
  referrer   User           @relation("ReferralsMade", fields: [referrerId], references: [id])
  referrerId String
  referee    User           @relation("ReferralReceived", fields: [refereeId], references: [id])
  refereeId  String         @unique
  status     ReferralStatus @default(PENDING)
  orderId    String?
  rewardedAt DateTime?
  createdAt  DateTime       @default(now())

  @@index([referrerId])
}

model Influencer {
  id            String   @id @default(cuid())
  name          String
  slug          String   @unique // tracked link: /?ref=slug
  couponOffer   Offer?   @relation(fields: [couponOfferId], references: [id])
  couponOfferId String?
  commissionBp  Int      // basis points of order value
  active        Boolean  @default(true)
  notes         String?
  createdAt     DateTime @default(now())

  commissions InfluencerCommission[]
}

model InfluencerCommission {
  id           String           @id @default(cuid())
  influencer   Influencer       @relation(fields: [influencerId], references: [id])
  influencerId String
  order        Order            @relation(fields: [orderId], references: [id])
  orderId      String
  amount       Int
  status       CommissionStatus @default(PENDING)
  releaseAt    DateTime         // after the return window closes
  paidAt       DateTime?

  @@unique([influencerId, orderId])
}

// ───────────────────── Tax & invoices (M3) ─────────────────────
model GstRule {
  id            String   @id @default(cuid())
  hsnPrefix     String   // longest-prefix match; "" = default
  thresholdPaise Int?    // per-piece pre-tax value at which the higher rate starts
  rateLowBp     Int      // e.g. 500
  rateHighBp    Int      // e.g. 1800
  effectiveFrom DateTime
  note          String?
}

model Invoice {
  id            String      @id @default(cuid())
  order         Order       @relation(fields: [orderId], references: [id])
  orderId       String      @unique
  kind          InvoiceKind @default(TAX_INVOICE)
  number        String      @unique
  financialYear String
  sellerGstin   String?
  buyerGstin    String?
  issuedAt      DateTime    @default(now())

  creditNotes CreditNote[]
}

model CreditNote {
  id         String   @id @default(cuid())
  invoice    Invoice  @relation(fields: [invoiceId], references: [id])
  invoiceId  String
  returnId   String?
  number     String   @unique
  amount     Int
  taxBreakup Json
  issuedAt   DateTime @default(now())
}

model InvoiceCounter {
  financialYear String @id // e.g. "2026-27"
  lastNumber    Int    @default(0)
}

// ───────────────────── Fulfilment, returns (M4) ─────────────────────
model Shipment {
  id                   String         @id @default(cuid())
  order                Order          @relation(fields: [orderId], references: [id])
  orderId              String
  carrier              String?
  awb                  String?
  trackingUrl          String?
  shiprocketOrderId    String?
  shiprocketShipmentId String?
  status               ShipmentStatus @default(CREATED)
  codAmount            Int            @default(0)
  codRemittedAt        DateTime?
  labelUrl             String?
  createdAt            DateTime       @default(now())

  events ShipmentEvent[]

  @@index([orderId])
  @@index([awb])
}

model ShipmentEvent {
  id          String   @id @default(cuid())
  shipment    Shipment @relation(fields: [shipmentId], references: [id], onDelete: Cascade)
  shipmentId  String
  status      String
  description String?
  location    String?
  occurredAt  DateTime
}

model Return {
  id           String       @id @default(cuid())
  order        Order        @relation(fields: [orderId], references: [id])
  orderId      String
  user         User         @relation(fields: [userId], references: [id])
  userId       String
  type         ReturnType
  status       ReturnStatus @default(REQUESTED)
  reason       String
  note         String?
  photos       String[]
  refundMethod RefundMethod?
  createdAt    DateTime     @default(now())
  updatedAt    DateTime     @updatedAt

  items   ReturnItem[]
  refunds Refund[]
}

model ReturnItem {
  id                String    @id @default(cuid())
  return            Return    @relation(fields: [returnId], references: [id], onDelete: Cascade)
  returnId          String
  orderItem         OrderItem @relation(fields: [orderItemId], references: [id])
  orderItemId       String
  qty               Int
  exchangeVariantId String?
}

model Refund {
  id               String       @id @default(cuid())
  order            Order        @relation(fields: [orderId], references: [id])
  orderId          String
  return           Return?      @relation(fields: [returnId], references: [id])
  returnId         String?
  amount           Int
  method           RefundMethod
  status           RefundStatus @default(PENDING)
  razorpayRefundId String?
  note             String?
  createdAt        DateTime     @default(now())
}

// ───────────────────── Customer features (M7) ─────────────────────
model WishlistItem {
  id        String   @id @default(cuid())
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  userId    String
  product   Product  @relation(fields: [productId], references: [id], onDelete: Cascade)
  productId String
  createdAt DateTime @default(now())

  @@unique([userId, productId])
}

model Review {
  id          String       @id @default(cuid())
  product     Product      @relation(fields: [productId], references: [id], onDelete: Cascade)
  productId   String
  user        User         @relation(fields: [userId], references: [id])
  userId      String
  orderItemId String?      // set when the reviewer actually bought it (verified buyer)
  rating      Int
  title       String?
  body        String
  photos      String[]
  status      ReviewStatus @default(PENDING)
  createdAt   DateTime     @default(now())

  @@unique([userId, productId])
}

model StockNotifyRequest {
  id         String         @id @default(cuid())
  variant    ProductVariant @relation(fields: [variantId], references: [id], onDelete: Cascade)
  variantId  String
  user       User?          @relation(fields: [userId], references: [id], onDelete: Cascade)
  userId     String?
  contact    String?
  notifiedAt DateTime?
  createdAt  DateTime       @default(now())

  @@unique([variantId, userId])
}

model Ticket {
  id             String        @id @default(cuid())
  number         String        @unique // e.g. TK-1042, shown to the customer
  user           User?         @relation(fields: [userId], references: [id])
  userId         String?
  orderId        String?
  contactName    String
  contactPhone   String?
  contactEmail   String?
  subject        String
  status         TicketStatus  @default(OPEN)
  acknowledgedAt DateTime?     // legal duty: acknowledge within 48h
  resolvedAt     DateTime?     // legal duty: resolve within one month
  createdAt      DateTime      @default(now())

  messages TicketMessage[]
}

model TicketMessage {
  id         String   @id @default(cuid())
  ticket     Ticket   @relation(fields: [ticketId], references: [id], onDelete: Cascade)
  ticketId   String
  authorType String   // CUSTOMER | STAFF
  authorId   String?
  body       String
  createdAt  DateTime @default(now())
}

// ───────────────────── Content & settings (M5) ─────────────────────
model Setting {
  key         String   @id // e.g. "shipping.freeThreshold", "cod.enabled", "store.gstin"
  value       Json
  updatedById String?
  updatedAt   DateTime @updatedAt
}

model Page {
  id             String     @id @default(cuid())
  slug           String     @unique // terms, privacy, refund-policy, shipping-policy, about, contact...
  title          String
  body           String     // sanitized on save and again on render
  status         PageStatus @default(DRAFT)
  seoTitle       String?
  seoDescription String?
  publishedAt    DateTime?
  updatedAt      DateTime   @updatedAt
}

model Article {
  id             String     @id @default(cuid())
  slug           String     @unique
  title          String
  excerpt        String?
  body           String
  coverUrl       String?
  status         PageStatus @default(DRAFT)
  seoTitle       String?
  seoDescription String?
  publishedAt    DateTime?
  updatedAt      DateTime   @updatedAt
}

model HomeSection {
  id       String    @id @default(cuid())
  type     String    // HERO | COLLECTION | BANNER | TEXT ...
  config   Json
  position Int       @default(0)
  active   Boolean   @default(true)
  startsAt DateTime?
  endsAt   DateTime?
}

model Banner {
  id       String    @id @default(cuid())
  text     String
  href     String?
  active   Boolean   @default(true)
  startsAt DateTime?
  endsAt   DateTime?
}

model NavLink {
  id       String  @id @default(cuid())
  area     String  // HEADER | FOOTER
  label    String
  href     String
  position Int     @default(0)
  active   Boolean @default(true)
}

model Faq {
  id       String  @id @default(cuid())
  question String
  answer   String
  scope    String  @default("GLOBAL") // GLOBAL | PRODUCT_PAGE
  position Int     @default(0)
  active   Boolean @default(true)
}

model SavedView {
  id      String @id @default(cuid())
  user    User   @relation(fields: [userId], references: [id], onDelete: Cascade)
  userId  String
  scope   String // ORDERS | PRODUCTS | CUSTOMERS
  name    String
  filters Json
}

model Segment {
  id        String   @id @default(cuid())
  name      String
  ruleJson  Json
  createdAt DateTime @default(now())
}

model PushSubscription {
  id        String   @id @default(cuid())
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  userId    String
  endpoint  String   @unique
  p256dh    String
  auth      String
  createdAt DateTime @default(now())
}

// ───────────────────── Messaging, consent, analytics, safety ─────────────────────
model MessageTemplate {
  id                   String         @id @default(cuid())
  key                  String         @unique // e.g. order_confirmed, cod_confirm, shipped
  channel              MessageChannel
  name                 String
  subject              String?
  body                 String
  active               Boolean        @default(true)
  providerTemplateName String?        // the Meta-approved WhatsApp template name
}

model MessageLog {
  id                String         @id @default(cuid())
  userId            String?
  channel           MessageChannel
  kind              MessageKind
  templateKey       String
  status            String
  providerMessageId String?
  error             String?
  createdAt         DateTime       @default(now())

  @@index([userId, kind, createdAt])
}

model ConsentRecord {
  id            String         @id @default(cuid())
  userId        String?
  anonId        String?
  purpose       ConsentPurpose
  granted       Boolean
  noticeVersion String
  channel       String         // BANNER | CHECKOUT | PREFERENCES
  createdAt     DateTime       @default(now())

  @@index([userId, purpose, createdAt])
  @@index([anonId, purpose, createdAt])
}

model AttributionTouch {
  id          String   @id @default(cuid())
  anonId      String
  userId      String?
  utmSource   String?
  utmMedium   String?
  utmCampaign String?
  utmContent  String?
  utmTerm     String?
  fbclid      String?
  referrer    String?
  landingPath String
  createdAt   DateTime @default(now())

  @@index([anonId, createdAt])
}

model AnalyticsEvent {
  id        String   @id @default(cuid())
  name      String   // view_item, add_to_cart, begin_checkout, purchase, search, search_no_result ...
  anonId    String
  userId    String?
  props     Json?
  createdAt DateTime @default(now())

  @@index([name, createdAt])
}

model AdSpend {
  id        String   @id @default(cuid())
  date      DateTime @db.Date
  channel   String   // META | GOOGLE | OTHER
  campaign  String   @default("")
  amount    Int      // paise
  createdAt DateTime @default(now())

  @@unique([date, channel, campaign])
}

model AuditLog {
  id        String   @id @default(cuid())
  actorId   String?
  action    String
  entity    String
  entityId  String?
  before    Json?
  after     Json?
  ipHash    String?
  createdAt DateTime @default(now())

  @@index([entity, entityId])
  @@index([actorId, createdAt])
}

model ProcessedWebhook {
  id         String   @id // provider event id, e.g. Razorpay's X-Razorpay-Event-Id
  provider   String
  receivedAt DateTime @default(now())
}

model EventOutbox {
  id            String    @id @default(cuid())
  kind          String    // META_CAPI | WHATSAPP_SEND | ...
  payload       Json
  attempts      Int       @default(0)
  nextAttemptAt DateTime  @default(now())
  processedAt   DateTime?
  createdAt     DateTime  @default(now())

  @@index([processedAt, nextAttemptAt])
}
```

## State machines

**`paymentStatus`**
| From | To | Trigger |
|---|---|---|
| `PENDING` | `PAID` | verified Razorpay signature or `payment.captured` webhook (prepaid only) |
| `PENDING` | `FAILED` | `payment.failed` webhook, or the stale-order cleanup job |
| `FAILED` | `PAID` | a late successful payment on the same Razorpay order (money was captured, so the order must reflect it) |
| `COD_PENDING` | `COD_COLLECTED` | courier delivery plus cash collected (Shiprocket status) |
| `PAID`, `COD_COLLECTED` | `PARTIALLY_REFUNDED`, `REFUNDED` | processed refund |
`PAID` is set in exactly one function (`markOrderPaid`) and never by an admin dropdown.

**`fulfilmentStatus`**
`CREATED` (prepaid, awaiting payment) → `PLACED` (paid, or COD submitted) → `CONFIRMED` (COD confirmed, or prepaid accepted) → `PACKED` → `SHIPPED` → `DELIVERED`.
`CANCELLED` is allowed from `CREATED`, `PLACED`, `CONFIRMED`, `PACKED` (restocks). `RTO` follows `SHIPPED` when the courier returns the parcel (restocks after receipt).

**`Return.status`**
`REQUESTED` → `APPROVED` → `PICKUP_SCHEDULED` → `RECEIVED` → `COMPLETED`; `REQUESTED` → `REJECTED`.
Refund and restock happen on `RECEIVED`, never on request.

## Invariants (tested, not assumed)
1. `ProductVariant.stock >= 0` always (database CHECK plus guarded decrement `UPDATE ... WHERE stock >= qty`).
2. Every stock change writes a `StockMovement` row in the same transaction.
3. Prepaid stock is decremented at payment; COD stock is decremented at placement; cancel, RTO and received returns put it back.
4. `Order.total = subtotal - discountTotal - prepaidDiscount + shippingFee + codFee - walletUsed`, and the sum of `OrderItem.discountAllocated` equals `discountTotal + prepaidDiscount`, exactly (largest-remainder rounding).
5. Tax is extracted from the discounted, GST-inclusive line value; per-line `gstRateBp` comes from `GstRule` using the line's per-piece pre-tax value.
6. `Wallet.balance` equals the sum of its `WalletEntry.amount`, updated in the same transaction as every entry. Credits are spent earliest-expiry first.
7. Invoice numbers are gapless and unique per financial year, allocated from `InvoiceCounter` inside the order transaction.
8. A webhook event id is processed at most once (`ProcessedWebhook`).
9. An `idempotencyKey` maps to at most one order.
10. `Order.userId` is required: checkout always happens after OTP login.

## Settings keys (stored in `Setting`, editable in admin, with typed defaults in code)
`store.legalName`, `store.gstin`, `store.stateCode`, `store.address`, `store.supportEmail`, `store.supportPhone`, `store.grievanceOfficer`,
`gst.enabled`, `gst.shippingTaxable`, `gst.codFeeTaxable`,
`shipping.flatFee`, `shipping.freeThreshold`, `shipping.stateRates`,
`cod.enabled`, `cod.maxOrderValue`, `cod.fee`, `cod.requireConfirmation`, `cod.maxPendingPerCustomer`,
`prepaid.discountType`, `prepaid.discountValue`, `prepaid.discountCap`, `prepaid.stacks`,
`offers.autoStack`, `offers.couponExclusive`, `offers.maxDiscountPercent`, `offers.floorToCost`,
`loyalty.earnPercent`, `loyalty.expiryDays`, `returns.windowDays`,
`inventory.lowStockThreshold`,
`seo.allowAiCrawlers`, `site.maintenanceMode`,
`flags.whatsappOtp`, `flags.cod`, `flags.reviews`, `flags.wishlist`.
A missing key always falls back to a safe default defined in code, so the store never breaks on an empty settings table.
