-- AlterEnum
ALTER TYPE "ReturnStatus" ADD VALUE IF NOT EXISTS 'RECEIVED';
ALTER TYPE "ReturnStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';

-- CreateEnum
CREATE TYPE "ReturnReasonCode" AS ENUM ('WRONG_SIZE', 'DEFECTIVE', 'NOT_AS_DESCRIBED', 'CHANGED_MIND', 'OTHER');

-- CreateEnum
CREATE TYPE "RefundMethod" AS ENUM ('RAZORPAY', 'STORE_CREDIT', 'MANUAL');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('PENDING', 'PROCESSED', 'FAILED');

-- AlterTable ReturnRequest
ALTER TABLE "ReturnRequest" ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMP(3);
ALTER TABLE "ReturnRequest" ADD COLUMN IF NOT EXISTS "receivedAt" TIMESTAMP(3);
ALTER TABLE "ReturnRequest" ADD COLUMN IF NOT EXISTS "refundInitiatedAt" TIMESTAMP(3);
ALTER TABLE "ReturnRequest" ADD COLUMN IF NOT EXISTS "rejectedReason" TEXT;
ALTER TABLE "ReturnRequest" ADD COLUMN IF NOT EXISTS "customerNote" TEXT;
ALTER TABLE "ReturnRequest" ADD COLUMN IF NOT EXISTS "reasonCode" "ReturnReasonCode" NOT NULL DEFAULT 'OTHER';

-- Update existing approved/refunded ReturnRequests with timestamps
UPDATE "ReturnRequest"
SET "approvedAt" = "updatedAt"
WHERE "status" IN ('APPROVED', 'REFUNDED') AND "approvedAt" IS NULL;

UPDATE "ReturnRequest"
SET "receivedAt" = "updatedAt",
    "refundInitiatedAt" = "updatedAt"
WHERE "status" = 'REFUNDED' AND "receivedAt" IS NULL;

-- CreateTable ReturnItem
CREATE TABLE IF NOT EXISTS "ReturnItem" (
    "id" TEXT NOT NULL,
    "returnId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "restock" BOOLEAN,
    "condition" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReturnItem_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ReturnItem_qty_check" CHECK ("qty" > 0)
);

-- CreateTable Refund
CREATE TABLE IF NOT EXISTS "Refund" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "returnId" TEXT,
    "method" "RefundMethod" NOT NULL,
    "status" "RefundStatus" NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "providerRefundId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "initiatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Refund_amountPaise_check" CHECK ("amountPaise" > 0)
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ReturnItem_orderItemId_idx" ON "ReturnItem"("orderItemId");
CREATE INDEX IF NOT EXISTS "ReturnItem_returnId_idx" ON "ReturnItem"("returnId");
CREATE UNIQUE INDEX IF NOT EXISTS "Refund_idempotencyKey_key" ON "Refund"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "Refund_orderId_idx" ON "Refund"("orderId");
CREATE INDEX IF NOT EXISTS "Refund_returnId_idx" ON "Refund"("returnId");

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ReturnItem_returnId_fkey'
    ) THEN
        ALTER TABLE "ReturnItem" ADD CONSTRAINT "ReturnItem_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "ReturnRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ReturnItem_orderItemId_fkey'
    ) THEN
        ALTER TABLE "ReturnItem" ADD CONSTRAINT "ReturnItem_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'Refund_orderId_fkey'
    ) THEN
        ALTER TABLE "Refund" ADD CONSTRAINT "Refund_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'Refund_returnId_fkey'
    ) THEN
        ALTER TABLE "Refund" ADD CONSTRAINT "Refund_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "ReturnRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- Backfill: every existing ReturnRequest gets ReturnItem rows covering what it actually returned (all non-gift items if it was whole-order)
INSERT INTO "ReturnItem" ("id", "returnId", "orderItemId", "qty", "restock", "condition", "createdAt")
SELECT
    'retitem_' || md5(random()::text || clock_timestamp()::text || oi."id"),
    rr."id",
    oi."id",
    oi."qty",
    true,
    'LEGACY_WHOLE_ORDER_RETURN',
    rr."createdAt"
FROM "ReturnRequest" rr
JOIN "Order" o ON rr."orderId" = o."id"
JOIN "OrderItem" oi ON oi."orderId" = o."id"
WHERE oi."isGift" = false
  AND NOT EXISTS (
    SELECT 1 FROM "ReturnItem" ri WHERE ri."returnId" = rr."id" AND ri."orderItemId" = oi."id"
  );

-- DO $$ guard raising on count mismatch
DO $$
DECLARE
    v_req_count INT;
    v_covered_req_count INT;
BEGIN
    SELECT COUNT(*) INTO v_req_count FROM "ReturnRequest";
    SELECT COUNT(DISTINCT "returnId") INTO v_covered_req_count FROM "ReturnItem";
    IF v_req_count != v_covered_req_count THEN
        RAISE EXCEPTION 'Backfill mismatch: % ReturnRequest rows but % covered in ReturnItem', v_req_count, v_covered_req_count;
    END IF;
END $$;
