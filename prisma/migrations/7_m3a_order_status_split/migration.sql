-- CreateEnum PaymentStatus
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'COD_PENDING', 'COD_COLLECTED', 'PARTIALLY_REFUNDED', 'REFUNDED');

-- CreateEnum FulfilmentStatus
CREATE TYPE "FulfilmentStatus" AS ENUM ('CREATED', 'PLACED', 'CONFIRMED', 'PACKED', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'RTO');

-- AlterTable Order: add paymentStatus and fulfilmentStatus with defaults
ALTER TABLE "Order" ADD COLUMN "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'PENDING';
ALTER TABLE "Order" ADD COLUMN "fulfilmentStatus" "FulfilmentStatus" NOT NULL DEFAULT 'CREATED';

-- AlterTable OrderStatusEvent: add nullable paymentStatus and fulfilmentStatus
ALTER TABLE "OrderStatusEvent" ADD COLUMN "paymentStatus" "PaymentStatus";
ALTER TABLE "OrderStatusEvent" ADD COLUMN "fulfilmentStatus" "FulfilmentStatus";

-- Guard: RAISE EXCEPTION if any unexpected (paymentMethod, status) combination exists on Order
DO $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT "paymentMethod", status, count(*) AS cnt
    FROM "Order"
    WHERE NOT (
      ("paymentMethod" = 'RAZORPAY' AND status IN ('PENDING', 'PAID', 'SHIPPED', 'DELIVERED', 'FAILED', 'CANCELLED'))
      OR ("paymentMethod" = 'COD' AND status IN ('PENDING', 'SHIPPED', 'DELIVERED', 'CANCELLED'))
      OR ("paymentMethod" = 'STORE_CREDIT' AND status IN ('PAID', 'SHIPPED', 'DELIVERED', 'CANCELLED'))
    )
    GROUP BY "paymentMethod", status
  LOOP
    RAISE EXCEPTION 'Unexpected (paymentMethod, status) combination in Order: % + % (count: %)', rec."paymentMethod", rec.status, rec.cnt;
  END LOOP;
END $$;

-- Backfill Order: base mapping by paymentMethod and status
UPDATE "Order" SET
  "paymentStatus" = CASE
    WHEN "paymentMethod" = 'RAZORPAY' AND status = 'PENDING' THEN 'PENDING'::"PaymentStatus"
    WHEN "paymentMethod" = 'RAZORPAY' AND status = 'PAID' THEN 'PAID'::"PaymentStatus"
    WHEN "paymentMethod" = 'RAZORPAY' AND status = 'SHIPPED' THEN 'PAID'::"PaymentStatus"
    WHEN "paymentMethod" = 'RAZORPAY' AND status = 'DELIVERED' THEN 'PAID'::"PaymentStatus"
    WHEN "paymentMethod" = 'RAZORPAY' AND status = 'FAILED' THEN 'FAILED'::"PaymentStatus"
    WHEN "paymentMethod" = 'RAZORPAY' AND status = 'CANCELLED' THEN (
      CASE WHEN "paidAt" IS NOT NULL THEN 'PAID'::"PaymentStatus" ELSE 'PENDING'::"PaymentStatus" END
    )
    WHEN "paymentMethod" = 'COD' AND status = 'PENDING' THEN 'COD_PENDING'::"PaymentStatus"
    WHEN "paymentMethod" = 'COD' AND status = 'SHIPPED' THEN 'COD_PENDING'::"PaymentStatus"
    WHEN "paymentMethod" = 'COD' AND status = 'DELIVERED' THEN 'COD_COLLECTED'::"PaymentStatus"
    WHEN "paymentMethod" = 'COD' AND status = 'CANCELLED' THEN 'COD_PENDING'::"PaymentStatus"
    WHEN "paymentMethod" = 'STORE_CREDIT' AND status = 'PAID' THEN 'PAID'::"PaymentStatus"
    WHEN "paymentMethod" = 'STORE_CREDIT' AND status = 'SHIPPED' THEN 'PAID'::"PaymentStatus"
    WHEN "paymentMethod" = 'STORE_CREDIT' AND status = 'DELIVERED' THEN 'PAID'::"PaymentStatus"
    WHEN "paymentMethod" = 'STORE_CREDIT' AND status = 'CANCELLED' THEN 'PAID'::"PaymentStatus"
  END,
  "fulfilmentStatus" = CASE
    WHEN "paymentMethod" = 'RAZORPAY' AND status = 'PENDING' THEN 'CREATED'::"FulfilmentStatus"
    WHEN "paymentMethod" = 'RAZORPAY' AND status = 'PAID' THEN 'PLACED'::"FulfilmentStatus"
    WHEN "paymentMethod" = 'RAZORPAY' AND status = 'SHIPPED' THEN 'SHIPPED'::"FulfilmentStatus"
    WHEN "paymentMethod" = 'RAZORPAY' AND status = 'DELIVERED' THEN 'DELIVERED'::"FulfilmentStatus"
    WHEN "paymentMethod" = 'RAZORPAY' AND status = 'FAILED' THEN 'CREATED'::"FulfilmentStatus"
    WHEN "paymentMethod" = 'RAZORPAY' AND status = 'CANCELLED' THEN 'CANCELLED'::"FulfilmentStatus"
    WHEN "paymentMethod" = 'COD' AND status = 'PENDING' THEN 'PLACED'::"FulfilmentStatus"
    WHEN "paymentMethod" = 'COD' AND status = 'SHIPPED' THEN 'SHIPPED'::"FulfilmentStatus"
    WHEN "paymentMethod" = 'COD' AND status = 'DELIVERED' THEN 'DELIVERED'::"FulfilmentStatus"
    WHEN "paymentMethod" = 'COD' AND status = 'CANCELLED' THEN 'CANCELLED'::"FulfilmentStatus"
    WHEN "paymentMethod" = 'STORE_CREDIT' AND status = 'PAID' THEN 'PLACED'::"FulfilmentStatus"
    WHEN "paymentMethod" = 'STORE_CREDIT' AND status = 'SHIPPED' THEN 'SHIPPED'::"FulfilmentStatus"
    WHEN "paymentMethod" = 'STORE_CREDIT' AND status = 'DELIVERED' THEN 'DELIVERED'::"FulfilmentStatus"
    WHEN "paymentMethod" = 'STORE_CREDIT' AND status = 'CANCELLED' THEN 'CANCELLED'::"FulfilmentStatus"
  END;

-- Refund overlay (RAZORPAY and STORE_CREDIT only): if refundedAt is not null
UPDATE "Order"
SET "paymentStatus" = CASE
  WHEN COALESCE("refundAmount", 0) >= total THEN 'REFUNDED'::"PaymentStatus"
  ELSE 'PARTIALLY_REFUNDED'::"PaymentStatus"
END
WHERE "paymentMethod" IN ('RAZORPAY', 'STORE_CREDIT')
  AND "refundedAt" IS NOT NULL;

-- Backfill OrderStatusEvent
UPDATE "OrderStatusEvent" e
SET
  "paymentStatus" = CASE
    WHEN e.status = 'PAID' THEN 'PAID'::"PaymentStatus"
    WHEN e.status = 'FAILED' THEN 'FAILED'::"PaymentStatus"
    ELSE NULL
  END,
  "fulfilmentStatus" = CASE
    WHEN e.status = 'PENDING' THEN (
      CASE WHEN o."paymentMethod" = 'COD' THEN 'PLACED'::"FulfilmentStatus" ELSE 'CREATED'::"FulfilmentStatus" END
    )
    WHEN e.status = 'PAID' THEN 'PLACED'::"FulfilmentStatus"
    WHEN e.status = 'SHIPPED' THEN 'SHIPPED'::"FulfilmentStatus"
    WHEN e.status = 'DELIVERED' THEN 'DELIVERED'::"FulfilmentStatus"
    WHEN e.status = 'CANCELLED' THEN 'CANCELLED'::"FulfilmentStatus"
    ELSE NULL
  END
FROM "Order" o
WHERE e."orderId" = o.id;

-- Create composite index on Order(paymentStatus, fulfilmentStatus, createdAt)
CREATE INDEX "Order_paymentStatus_fulfilmentStatus_createdAt_idx" ON "Order"("paymentStatus", "fulfilmentStatus", "createdAt");
