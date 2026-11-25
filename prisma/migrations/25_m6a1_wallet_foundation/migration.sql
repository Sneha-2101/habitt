-- M6a-1: Wallet & Store Credit Foundation (no backfill by design: cutover is M6a-2)

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'WalletLotKind') THEN
        CREATE TYPE "WalletLotKind" AS ENUM ('REFUND', 'PROMO', 'ADJUST');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'WalletEntryType') THEN
        CREATE TYPE "WalletEntryType" AS ENUM ('CREDIT', 'DEBIT', 'EXPIRE', 'ADJUST');
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS "WalletLot" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "WalletLotKind" NOT NULL,
    "originalPaise" INTEGER NOT NULL,
    "remainingPaise" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "sourceType" TEXT,
    "sourceId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WalletLot_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "WalletLot_originalPaise_check" CHECK ("originalPaise" > 0),
    CONSTRAINT "WalletLot_remainingPaise_check" CHECK ("remainingPaise" >= 0 AND "remainingPaise" <= "originalPaise")
);

CREATE UNIQUE INDEX IF NOT EXISTS "WalletLot_userId_kind_sourceType_sourceId_key"
    ON "WalletLot"("userId", "kind", "sourceType", "sourceId");
CREATE INDEX IF NOT EXISTS "WalletLot_userId_remainingPaise_expiresAt_idx"
    ON "WalletLot"("userId", "remainingPaise", "expiresAt");
CREATE INDEX IF NOT EXISTS "WalletLot_expiresAt_remainingPaise_idx"
    ON "WalletLot"("expiresAt", "remainingPaise");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'WalletLot_userId_fkey'
    ) THEN
        ALTER TABLE "WalletLot"
        ADD CONSTRAINT "WalletLot_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS "WalletEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lotId" TEXT,
    "type" "WalletEntryType" NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "balanceAfterPaise" INTEGER NOT NULL,
    "orderId" TEXT,
    "actorId" TEXT,
    "reason" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletEntry_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "WalletEntry_amountPaise_nonzero_check" CHECK ("amountPaise" <> 0),
    CONSTRAINT "WalletEntry_balanceAfterPaise_check" CHECK ("balanceAfterPaise" >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "WalletEntry_idempotencyKey_key"
    ON "WalletEntry"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "WalletEntry_userId_createdAt_idx"
    ON "WalletEntry"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "WalletEntry_lotId_idx"
    ON "WalletEntry"("lotId");
CREATE INDEX IF NOT EXISTS "WalletEntry_orderId_idx"
    ON "WalletEntry"("orderId");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'WalletEntry_userId_fkey'
    ) THEN
        ALTER TABLE "WalletEntry"
        ADD CONSTRAINT "WalletEntry_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'WalletEntry_lotId_fkey'
    ) THEN
        ALTER TABLE "WalletEntry"
        ADD CONSTRAINT "WalletEntry_lotId_fkey"
        FOREIGN KEY ("lotId") REFERENCES "WalletLot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

ALTER TABLE "SiteSettings" ADD COLUMN IF NOT EXISTS "promoCreditExpiryDays" INTEGER NOT NULL DEFAULT 90;
ALTER TABLE "SiteSettings" ADD COLUMN IF NOT EXISTS "walletMaxPercentOfOrder" INTEGER NOT NULL DEFAULT 100;
ALTER TABLE "SiteSettings" ADD COLUMN IF NOT EXISTS "maxAdminAdjustPaise" INTEGER NOT NULL DEFAULT 500000;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SiteSettings_promoCreditExpiryDays_check') THEN
        ALTER TABLE "SiteSettings" ADD CONSTRAINT "SiteSettings_promoCreditExpiryDays_check" CHECK ("promoCreditExpiryDays" > 0);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SiteSettings_walletMaxPercentOfOrder_check') THEN
        ALTER TABLE "SiteSettings" ADD CONSTRAINT "SiteSettings_walletMaxPercentOfOrder_check" CHECK ("walletMaxPercentOfOrder" >= 1 AND "walletMaxPercentOfOrder" <= 100);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SiteSettings_maxAdminAdjustPaise_check') THEN
        ALTER TABLE "SiteSettings" ADD CONSTRAINT "SiteSettings_maxAdminAdjustPaise_check" CHECK ("maxAdminAdjustPaise" > 0);
    END IF;
END $$;
