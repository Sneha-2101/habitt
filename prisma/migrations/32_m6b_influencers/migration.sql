-- CreateEnum
CREATE TYPE "InfluencerAttributionSource" AS ENUM ('COUPON', 'LINK');

-- CreateTable
CREATE TABLE "Influencer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "email" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "offerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Influencer_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "influencerId" TEXT,
ADD COLUMN "influencerSource" "InfluencerAttributionSource";

-- AlterTable
ALTER TABLE "SiteSettings" ADD COLUMN "influencerCookieDays" INTEGER NOT NULL DEFAULT 30;

-- CreateIndex
CREATE UNIQUE INDEX "Influencer_code_key" ON "Influencer"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Influencer_offerId_key" ON "Influencer"("offerId");

-- CreateIndex
CREATE INDEX "Order_influencerId_createdAt_idx" ON "Order"("influencerId", "createdAt");

-- AddForeignKey
ALTER TABLE "Influencer" ADD CONSTRAINT "Influencer_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_influencerId_fkey" FOREIGN KEY ("influencerId") REFERENCES "Influencer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
