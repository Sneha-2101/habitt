-- Migration 20: M4a Fix 1 - COD fee and feesRefunded on Order
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "codFee" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "feesRefunded" BOOLEAN NOT NULL DEFAULT false;

-- Backfill codFee for existing COD orders where total exceeds subtotal + shippingFee
UPDATE "Order"
SET "codFee" = GREATEST(0, "total" - "subtotal" + COALESCE("discountAmount", 0) - "shippingFee")
WHERE "paymentMethod" = 'COD' AND "codFee" = 0;

-- Backfill feesRefunded for orders whose processed refunds cover or exceed order total
UPDATE "Order"
SET "feesRefunded" = true
WHERE "id" IN (
  SELECT o."id" FROM "Order" o
  JOIN "Refund" r ON r."orderId" = o."id"
  WHERE r."status" = 'PROCESSED'
  GROUP BY o."id", o."total"
  HAVING SUM(r."amountPaise") >= o."total"
);
