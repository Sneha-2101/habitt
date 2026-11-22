-- Migration 21: M4b Shipments, ShipmentEvents, EventOutbox, CronRun
-- CreateEnum
CREATE TYPE "ShipmentProvider" AS ENUM ('MANUAL', 'SHIPROCKET');

-- CreateEnum
CREATE TYPE "ShipmentStatus" AS ENUM ('CREATED', 'AWB_ASSIGNED', 'PICKUP_SCHEDULED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'RTO_INITIATED', 'RTO_DELIVERED', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "Shipment" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "provider" "ShipmentProvider" NOT NULL,
    "status" "ShipmentStatus" NOT NULL DEFAULT 'CREATED',
    "awb" TEXT,
    "courierName" TEXT,
    "trackingUrl" TEXT,
    "providerOrderId" TEXT,
    "providerShipmentId" TEXT,
    "labelUrl" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "lastEventAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShipmentEvent" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "status" "ShipmentStatus" NOT NULL,
    "rawStatus" TEXT NOT NULL,
    "location" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShipmentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventOutbox" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "orderId" TEXT,
    "payload" JSONB NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "EventOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CronRun" (
    "id" TEXT NOT NULL,
    "job" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "ok" BOOLEAN,
    "itemsProcessed" INTEGER,
    "error" TEXT,

    CONSTRAINT "CronRun_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentEvent" ADD CONSTRAINT "ShipmentEvent_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndexes
CREATE INDEX "Shipment_orderId_idx" ON "Shipment"("orderId");
CREATE UNIQUE INDEX "Shipment_active_orderId_idx" ON "Shipment"("orderId") WHERE "status" NOT IN ('CANCELLED', 'FAILED');

CREATE UNIQUE INDEX "ShipmentEvent_dedupeKey_key" ON "ShipmentEvent"("dedupeKey");
CREATE INDEX "ShipmentEvent_shipmentId_idx" ON "ShipmentEvent"("shipmentId");

CREATE UNIQUE INDEX "EventOutbox_dedupeKey_key" ON "EventOutbox"("dedupeKey");
CREATE INDEX "EventOutbox_status_nextAttemptAt_idx" ON "EventOutbox"("status", "nextAttemptAt");

CREATE INDEX "CronRun_job_startedAt_idx" ON "CronRun"("job", "startedAt");

-- Backfill: for every existing order that has awbNumber/courierName and status SHIPPED/DELIVERED/RTO
-- create a MANUAL Shipment with a DO $$ guard raising on count mismatch.
DO $$
DECLARE
    expected_count INTEGER;
    inserted_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO expected_count
    FROM "Order"
    WHERE ("awbNumber" IS NOT NULL OR "courierName" IS NOT NULL)
      AND "fulfilmentStatus" IN ('SHIPPED', 'DELIVERED', 'RTO');

    INSERT INTO "Shipment" (
        "id",
        "orderId",
        "provider",
        "status",
        "awb",
        "courierName",
        "trackingUrl",
        "createdAt",
        "updatedAt"
    )
    SELECT
        'shpm_' || substr(md5(random()::text || clock_timestamp()::text), 1, 24),
        "id",
        'MANUAL'::"ShipmentProvider",
        CASE
            WHEN "fulfilmentStatus" = 'DELIVERED' THEN 'DELIVERED'::"ShipmentStatus"
            WHEN "fulfilmentStatus" = 'RTO' THEN 'RTO_DELIVERED'::"ShipmentStatus"
            ELSE 'IN_TRANSIT'::"ShipmentStatus"
        END,
        "awbNumber",
        "courierName",
        "trackingUrl",
        COALESCE("shippedAt", "createdAt"),
        CURRENT_TIMESTAMP
    FROM "Order"
    WHERE ("awbNumber" IS NOT NULL OR "courierName" IS NOT NULL)
      AND "fulfilmentStatus" IN ('SHIPPED', 'DELIVERED', 'RTO');

    GET DIAGNOSTICS inserted_count = ROW_COUNT;

    IF inserted_count != expected_count THEN
        RAISE EXCEPTION 'Shipment backfill count mismatch: expected %, inserted %', expected_count, inserted_count;
    END IF;
END $$;
