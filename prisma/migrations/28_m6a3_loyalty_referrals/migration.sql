-- M6a-3: Loyalty & Referrals Foundation

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'LoyaltyAccrualStatus') THEN
        CREATE TYPE "LoyaltyAccrualStatus" AS ENUM ('CREDITED', 'SKIPPED');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ReferralStatus') THEN
        CREATE TYPE "ReferralStatus" AS ENUM ('PENDING_VERIFICATION', 'PENDING_FIRST_ORDER', 'REWARDED', 'REJECTED', 'EXPIRED');
    END IF;
END $$;

ALTER TABLE "SiteSettings" ADD COLUMN IF NOT EXISTS "loyaltyEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SiteSettings" ADD COLUMN IF NOT EXISTS "loyaltyModel" TEXT NOT NULL DEFAULT 'FLAT_PERCENT';
ALTER TABLE "SiteSettings" ADD COLUMN IF NOT EXISTS "loyaltyPercentBps" INTEGER NOT NULL DEFAULT 200;
ALTER TABLE "SiteSettings" ADD COLUMN IF NOT EXISTS "referralEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SiteSettings" ADD COLUMN IF NOT EXISTS "referrerRewardPaise" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "SiteSettings" ADD COLUMN IF NOT EXISTS "refereeRewardPaise" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "SiteSettings" ADD COLUMN IF NOT EXISTS "referralMonthlyCapPerReferrer" INTEGER NOT NULL DEFAULT 10;
ALTER TABLE "SiteSettings" ADD COLUMN IF NOT EXISTS "referralMinOrderPaise" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "SiteSettings" ADD COLUMN IF NOT EXISTS "referralValidityDays" INTEGER NOT NULL DEFAULT 90;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SiteSettings_loyaltyModel_check') THEN
        ALTER TABLE "SiteSettings" ADD CONSTRAINT "SiteSettings_loyaltyModel_check" CHECK ("loyaltyModel" IN ('FLAT_PERCENT'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SiteSettings_loyaltyPercentBps_check') THEN
        ALTER TABLE "SiteSettings" ADD CONSTRAINT "SiteSettings_loyaltyPercentBps_check" CHECK ("loyaltyPercentBps" >= 0 AND "loyaltyPercentBps" <= 5000);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SiteSettings_referrerRewardPaise_check') THEN
        ALTER TABLE "SiteSettings" ADD CONSTRAINT "SiteSettings_referrerRewardPaise_check" CHECK ("referrerRewardPaise" >= 0 AND "referrerRewardPaise" <= 1000000);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SiteSettings_refereeRewardPaise_check') THEN
        ALTER TABLE "SiteSettings" ADD CONSTRAINT "SiteSettings_refereeRewardPaise_check" CHECK ("refereeRewardPaise" >= 0 AND "refereeRewardPaise" <= 1000000);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SiteSettings_referralMonthlyCapPerReferrer_check') THEN
        ALTER TABLE "SiteSettings" ADD CONSTRAINT "SiteSettings_referralMonthlyCapPerReferrer_check" CHECK ("referralMonthlyCapPerReferrer" >= 0 AND "referralMonthlyCapPerReferrer" <= 1000);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SiteSettings_referralMinOrderPaise_check') THEN
        ALTER TABLE "SiteSettings" ADD CONSTRAINT "SiteSettings_referralMinOrderPaise_check" CHECK ("referralMinOrderPaise" >= 0);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SiteSettings_referralValidityDays_check') THEN
        ALTER TABLE "SiteSettings" ADD CONSTRAINT "SiteSettings_referralValidityDays_check" CHECK ("referralValidityDays" >= 1 AND "referralValidityDays" <= 3650);
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS "LoyaltyAccrual" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "basePaise" INTEGER NOT NULL,
    "earnedPaise" INTEGER NOT NULL,
    "status" "LoyaltyAccrualStatus" NOT NULL,
    "lotId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoyaltyAccrual_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "LoyaltyAccrual_earnedPaise_check" CHECK ("earnedPaise" >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "LoyaltyAccrual_orderId_key" ON "LoyaltyAccrual"("orderId");
CREATE INDEX IF NOT EXISTS "LoyaltyAccrual_userId_createdAt_idx" ON "LoyaltyAccrual"("userId", "createdAt");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LoyaltyAccrual_orderId_fkey') THEN
        ALTER TABLE "LoyaltyAccrual" ADD CONSTRAINT "LoyaltyAccrual_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LoyaltyAccrual_userId_fkey') THEN
        ALTER TABLE "LoyaltyAccrual" ADD CONSTRAINT "LoyaltyAccrual_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LoyaltyAccrual_lotId_fkey') THEN
        ALTER TABLE "LoyaltyAccrual" ADD CONSTRAINT "LoyaltyAccrual_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "WalletLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS "ReferralCode" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferralCode_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ReferralCode_userId_key" ON "ReferralCode"("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "ReferralCode_code_key" ON "ReferralCode"("code");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ReferralCode_userId_fkey') THEN
        ALTER TABLE "ReferralCode" ADD CONSTRAINT "ReferralCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS "Referral" (
    "id" TEXT NOT NULL,
    "referrerId" TEXT NOT NULL,
    "refereeId" TEXT NOT NULL,
    "codeUsed" TEXT NOT NULL,
    "status" "ReferralStatus" NOT NULL,
    "rejectionReason" TEXT,
    "refereeLotId" TEXT,
    "referrerLotId" TEXT,
    "firstOrderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Referral_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Referral_no_self_referral_check" CHECK ("referrerId" <> "refereeId")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Referral_refereeId_key" ON "Referral"("refereeId");
CREATE INDEX IF NOT EXISTS "Referral_referrerId_status_idx" ON "Referral"("referrerId", "status");
CREATE INDEX IF NOT EXISTS "Referral_status_expiresAt_idx" ON "Referral"("status", "expiresAt");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Referral_referrerId_fkey') THEN
        ALTER TABLE "Referral" ADD CONSTRAINT "Referral_referrerId_fkey" FOREIGN KEY ("referrerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Referral_refereeId_fkey') THEN
        ALTER TABLE "Referral" ADD CONSTRAINT "Referral_refereeId_fkey" FOREIGN KEY ("refereeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Referral_refereeLotId_fkey') THEN
        ALTER TABLE "Referral" ADD CONSTRAINT "Referral_refereeLotId_fkey" FOREIGN KEY ("refereeLotId") REFERENCES "WalletLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Referral_referrerLotId_fkey') THEN
        ALTER TABLE "Referral" ADD CONSTRAINT "Referral_referrerLotId_fkey" FOREIGN KEY ("referrerLotId") REFERENCES "WalletLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS "ReferralClaim" (
    "id" TEXT NOT NULL,
    "refereeId" TEXT NOT NULL,
    "normalizedEmail" TEXT NOT NULL,
    "normalizedPhone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferralClaim_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ReferralClaim_normalizedEmail_key" ON "ReferralClaim"("normalizedEmail");
CREATE UNIQUE INDEX IF NOT EXISTS "ReferralClaim_normalizedPhone_key" ON "ReferralClaim"("normalizedPhone") WHERE "normalizedPhone" IS NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ReferralClaim_refereeId_fkey') THEN
        ALTER TABLE "ReferralClaim" ADD CONSTRAINT "ReferralClaim_refereeId_fkey" FOREIGN KEY ("refereeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;
