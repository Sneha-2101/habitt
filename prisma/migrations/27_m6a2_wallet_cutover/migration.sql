-- M6a-2: Wallet cutover (RESTRICT FKs, SiteSettings defaults, idempotent legacy backfill + reconcile)

-- 1. Replace CASCADE with RESTRICT on WalletLot and WalletEntry FKs
ALTER TABLE "WalletLot" DROP CONSTRAINT IF EXISTS "WalletLot_userId_fkey";
ALTER TABLE "WalletLot"
    ADD CONSTRAINT "WalletLot_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WalletEntry" DROP CONSTRAINT IF EXISTS "WalletEntry_userId_fkey";
ALTER TABLE "WalletEntry"
    ADD CONSTRAINT "WalletEntry_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WalletEntry" DROP CONSTRAINT IF EXISTS "WalletEntry_lotId_fkey";
ALTER TABLE "WalletEntry"
    ADD CONSTRAINT "WalletEntry_lotId_fkey"
    FOREIGN KEY ("lotId") REFERENCES "WalletLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 2. SiteSettings: default promoCreditExpiryDays = 180 and allow 0..100 for walletMaxPercentOfOrder
ALTER TABLE "SiteSettings" ALTER COLUMN "promoCreditExpiryDays" SET DEFAULT 180;
-- The dev SiteSettings row was never edited from the M6a-1 initial default of 90.
UPDATE "SiteSettings" SET "promoCreditExpiryDays" = 180 WHERE "promoCreditExpiryDays" = 90;

ALTER TABLE "SiteSettings" DROP CONSTRAINT IF EXISTS "SiteSettings_walletMaxPercentOfOrder_check";
ALTER TABLE "SiteSettings"
    ADD CONSTRAINT "SiteSettings_walletMaxPercentOfOrder_check"
    CHECK ("walletMaxPercentOfOrder" >= 0 AND "walletMaxPercentOfOrder" <= 100);

-- 3. Idempotent backfill of legacy User.storeCreditBalance > 0 into WalletLot + WalletEntry
INSERT INTO "WalletLot" (
    "id",
    "userId",
    "kind",
    "originalPaise",
    "remainingPaise",
    "expiresAt",
    "sourceType",
    "sourceId",
    "note",
    "createdAt",
    "updatedAt"
)
SELECT
    'wl_' || md5(random()::text || clock_timestamp()::text || u."id"),
    u."id",
    'REFUND'::"WalletLotKind",
    u."storeCreditBalance",
    u."storeCreditBalance",
    NULL,
    'LEGACY_STORE_CREDIT',
    u."id",
    'Migrated from legacy store credit',
    NOW(),
    NOW()
FROM "User" u
WHERE u."storeCreditBalance" > 0
  AND NOT EXISTS (
      SELECT 1
      FROM "WalletLot" wl
      WHERE wl."userId" = u."id"
        AND wl."kind" = 'REFUND'::"WalletLotKind"
        AND wl."sourceType" = 'LEGACY_STORE_CREDIT'
        AND wl."sourceId" = u."id"
  );

INSERT INTO "WalletEntry" (
    "id",
    "userId",
    "lotId",
    "type",
    "amountPaise",
    "balanceAfterPaise",
    "orderId",
    "actorId",
    "reason",
    "idempotencyKey",
    "createdAt"
)
SELECT
    'we_' || md5(random()::text || clock_timestamp()::text || wl."id"),
    u."id",
    wl."id",
    'CREDIT'::"WalletEntryType",
    u."storeCreditBalance",
    COALESCE((
        SELECT SUM(l."remainingPaise")
        FROM "WalletLot" l
        WHERE l."userId" = u."id"
          AND l."remainingPaise" > 0
          AND (l."expiresAt" IS NULL OR l."expiresAt" > NOW())
    ), u."storeCreditBalance"),
    NULL,
    NULL,
    'Migrated from legacy store credit',
    'legacy:' || u."id",
    NOW()
FROM "User" u
JOIN "WalletLot" wl
  ON wl."userId" = u."id"
 AND wl."kind" = 'REFUND'::"WalletLotKind"
 AND wl."sourceType" = 'LEGACY_STORE_CREDIT'
 AND wl."sourceId" = u."id"
WHERE u."storeCreditBalance" > 0
  AND NOT EXISTS (
      SELECT 1
      FROM "WalletEntry" we
      WHERE we."idempotencyKey" = 'legacy:' || u."id"
  );

-- 4. Reconcile assertion
DO $$
DECLARE
    v_legacy_sum BIGINT;
    v_wallet_sum BIGINT;
BEGIN
    SELECT COALESCE(SUM("storeCreditBalance"), 0) INTO v_legacy_sum
    FROM "User"
    WHERE "storeCreditBalance" > 0;

    SELECT COALESCE(SUM("remainingPaise"), 0) INTO v_wallet_sum
    FROM "WalletLot"
    WHERE "kind" = 'REFUND'::"WalletLotKind"
      AND "sourceType" = 'LEGACY_STORE_CREDIT';

    RAISE NOTICE 'Wallet backfill reconcile: legacy_sum=%, wallet_sum=%', v_legacy_sum, v_wallet_sum;

    IF v_legacy_sum <> v_wallet_sum THEN
        RAISE EXCEPTION 'Wallet backfill mismatch: legacy_sum=% != wallet_sum=%', v_legacy_sum, v_wallet_sum;
    END IF;
END $$;
