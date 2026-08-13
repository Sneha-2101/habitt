# Schema — Habitt (Prisma / PostgreSQL via Supabase)

```prisma
model Product {
  id          String   @id @default(cuid())
  name        String
  slug        String   @unique
  description String
  category    Category
  price       Int      // paise (store as integer to avoid float rounding on money)
  status      ProductStatus @default(DRAFT)
  images      ProductImage[]
  variants    ProductVariant[]
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

model ProductImage {
  id        String  @id @default(cuid())
  product   Product @relation(fields: [productId], references: [id], onDelete: Cascade)
  productId String
  url       String   // Supabase Storage public URL
  position  Int      @default(0)
}

model ProductVariant {
  id        String  @id @default(cuid())
  product   Product @relation(fields: [productId], references: [id], onDelete: Cascade)
  productId String
  size      Size
  stock     Int      @default(0)

  @@unique([productId, size])
}

enum Category {
  SHIRTS
  OVERSHIRTS
  POLOS
  TROUSERS
}

enum Size {
  S
  M
  L
  XL
  XXL
}

enum ProductStatus {
  DRAFT
  ACTIVE
  ARCHIVED
}

model Order {
  id                String      @id @default(cuid())
  displayId         String      @unique // e.g. HB-10231, shown to customer
  user              User        @relation(fields: [userId], references: [id])
  userId            String      // required — checkout requires login
  customerName      String
  customerPhone     String
  customerEmail     String?
  shippingAddress   Json        // {line1, line2, city, state, pincode}
  items             OrderItem[]
  subtotal          Int         // paise
  shippingFee       Int         @default(0)
  total             Int
  status            OrderStatus @default(PENDING)
  razorpayOrderId   String?     @unique
  razorpayPaymentId String?
  paidAt            DateTime?
  createdAt         DateTime    @default(now())
  updatedAt         DateTime    @updatedAt
}

model OrderItem {
  id         String  @id @default(cuid())
  order      Order   @relation(fields: [orderId], references: [id], onDelete: Cascade)
  orderId    String
  productId  String
  variantId  String
  name       String  // snapshot at time of purchase (product name/price can change later)
  size       Size
  unitPrice  Int
  qty        Int
}

enum OrderStatus {
  PENDING      // created, awaiting payment
  PAID         // payment verified
  SHIPPED
  DELIVERED
  CANCELLED
  FAILED       // payment failed / abandoned
}

// Single table for everyone who can log in — customers and staff. Login is
// required to buy, and the same /login page authenticates both; only the
// role differs what it unlocks afterwards (see AppFlow.md and Design.md).
model User {
  id           String   @id @default(cuid())
  email        String   @unique
  passwordHash String
  name         String
  phone        String?
  role         Role     @default(CUSTOMER)
  orders       Order[]
  createdAt    DateTime @default(now())
}

enum Role {
  CUSTOMER
  STAFF
  OWNER
}
```

## Notes
- **Money as integers (paise)**, never floats — avoids rounding bugs at checkout and in reports.
- `OrderItem` snapshots `name` and `unitPrice` rather than joining live to `Product`, so past orders stay accurate even if a product is later renamed, repriced, or archived.
- `razorpayOrderId` is unique and set at order-creation time, before payment — lets the webhook find the matching local order by that id.
- Stock lives on `ProductVariant` (per size), decremented inside the same DB transaction that sets `Order.status = PAID`, to prevent overselling.
- `displayId` is the human-facing order number (e.g. `HB-10231`); `id` (cuid) is the internal key — keeps public URLs/emails clean while internal joins stay on stable ids.
