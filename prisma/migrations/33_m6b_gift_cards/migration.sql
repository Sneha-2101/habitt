-- CreateEnum
CREATE TYPE "GiftCardStatus" AS ENUM ('ISSUED', 'REDEEMED', 'VOID');

-- CreateTable
CREATE TABLE "GiftCard" (
    "id" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "last4" TEXT NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "status" "GiftCardStatus" NOT NULL DEFAULT 'ISSUED',
    "redeemBy" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "redeemedById" TEXT,
    "redeemedAt" TIMESTAMP(3),
    "walletLotId" TEXT,
    "voidedById" TEXT,
    "voidedAt" TIMESTAMP(3),

    CONSTRAINT "GiftCard_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GiftCard_codeHash_key" ON "GiftCard"("codeHash");

-- CreateIndex
CREATE UNIQUE INDEX "GiftCard_walletLotId_key" ON "GiftCard"("walletLotId");

-- CreateIndex
CREATE INDEX "GiftCard_status_idx" ON "GiftCard"("status");

-- CreateIndex
CREATE INDEX "GiftCard_redeemBy_idx" ON "GiftCard"("redeemBy");

-- CreateIndex
CREATE INDEX "GiftCard_createdAt_idx" ON "GiftCard"("createdAt");

-- AddForeignKey
ALTER TABLE "GiftCard" ADD CONSTRAINT "GiftCard_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftCard" ADD CONSTRAINT "GiftCard_redeemedById_fkey" FOREIGN KEY ("redeemedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftCard" ADD CONSTRAINT "GiftCard_walletLotId_fkey" FOREIGN KEY ("walletLotId") REFERENCES "WalletLot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftCard" ADD CONSTRAINT "GiftCard_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
