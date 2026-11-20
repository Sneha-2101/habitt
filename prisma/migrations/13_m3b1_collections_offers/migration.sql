-- CreateTable Collection
CREATE TABLE "Collection" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Collection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Collection_slug_key" ON "Collection"("slug");

-- CreateTable ProductCollection
CREATE TABLE "ProductCollection" (
    "productId" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,

    CONSTRAINT "ProductCollection_pkey" PRIMARY KEY ("productId","collectionId")
);

-- CreateEnum OfferKind
CREATE TYPE "OfferKind" AS ENUM ('PERCENT_OFF', 'FLAT_OFF', 'TIER', 'COMBO_ANY', 'COMBO_SLOTS', 'GIFT');

-- CreateEnum OfferAudience
CREATE TYPE "OfferAudience" AS ENUM ('ALL', 'FIRST_ORDER', 'BIRTHDAY');

-- CreateTable Offer
CREATE TABLE "Offer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "OfferKind" NOT NULL,
    "code" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "minCartPaise" INTEGER NOT NULL DEFAULT 0,
    "maxUsesTotal" INTEGER,
    "maxUsesPerCustomer" INTEGER,
    "timesUsed" INTEGER NOT NULL DEFAULT 0,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "audience" "OfferAudience" NOT NULL DEFAULT 'ALL',
    "config" JSONB NOT NULL,
    "legacyCouponId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Offer_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Offer_code_check" CHECK ("code" IS NULL OR "code" = upper("code")),
    CONSTRAINT "Offer_dates_check" CHECK ("endsAt" IS NULL OR "startsAt" IS NULL OR "endsAt" > "startsAt"),
    CONSTRAINT "Offer_minCartPaise_check" CHECK ("minCartPaise" >= 0),
    CONSTRAINT "Offer_maxUsesTotal_check" CHECK ("maxUsesTotal" IS NULL OR "maxUsesTotal" > 0),
    CONSTRAINT "Offer_maxUsesPerCustomer_check" CHECK ("maxUsesPerCustomer" IS NULL OR "maxUsesPerCustomer" > 0)
);

-- CreateIndex
CREATE UNIQUE INDEX "Offer_code_key" ON "Offer"("code");
CREATE UNIQUE INDEX "Offer_legacyCouponId_key" ON "Offer"("legacyCouponId");

-- CreateTable OfferTarget
CREATE TABLE "OfferTarget" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "categoryId" TEXT,
    "productId" TEXT,
    "collectionId" TEXT,

    CONSTRAINT "OfferTarget_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "OfferTarget_target_exact_one_check" CHECK (num_nonnulls("categoryId", "productId", "collectionId") = 1)
);

-- CreateIndex
CREATE UNIQUE INDEX "OfferTarget_offerId_categoryId_key" ON "OfferTarget"("offerId", "categoryId");
CREATE UNIQUE INDEX "OfferTarget_offerId_productId_key" ON "OfferTarget"("offerId", "productId");
CREATE UNIQUE INDEX "OfferTarget_offerId_collectionId_key" ON "OfferTarget"("offerId", "collectionId");

-- CreateTable OfferRedemption
CREATE TABLE "OfferRedemption" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "userId" TEXT,
    "amountPaise" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OfferRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OfferRedemption_offerId_orderId_key" ON "OfferRedemption"("offerId", "orderId");

-- CreateEnum OrderDiscountKind
CREATE TYPE "OrderDiscountKind" AS ENUM ('PERCENT_OFF', 'FLAT_OFF', 'TIER', 'COMBO_ANY', 'COMBO_SLOTS', 'GIFT_STOCK', 'GIFT_TEXT', 'COUPON_PERCENT', 'COUPON_FLAT');

-- CreateTable OrderDiscount
CREATE TABLE "OrderDiscount" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "offerId" TEXT,
    "label" TEXT NOT NULL,
    "kind" "OrderDiscountKind" NOT NULL,
    "amountPaise" INTEGER NOT NULL DEFAULT 0,
    "orderItemId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderDiscount_pkey" PRIMARY KEY ("id")
);

-- AlterTable OrderItem
ALTER TABLE "OrderItem" ADD COLUMN "discountPaise" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "OrderItem" ADD COLUMN "isGift" BOOLEAN NOT NULL DEFAULT false;

-- AddForeignKeys
ALTER TABLE "ProductCollection" ADD CONSTRAINT "ProductCollection_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductCollection" ADD CONSTRAINT "ProductCollection_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "Collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OfferTarget" ADD CONSTRAINT "OfferTarget_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OfferTarget" ADD CONSTRAINT "OfferTarget_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OfferTarget" ADD CONSTRAINT "OfferTarget_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OfferTarget" ADD CONSTRAINT "OfferTarget_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "Collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OfferRedemption" ADD CONSTRAINT "OfferRedemption_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OfferRedemption" ADD CONSTRAINT "OfferRedemption_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OfferRedemption" ADD CONSTRAINT "OfferRedemption_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "OrderDiscount" ADD CONSTRAINT "OrderDiscount_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderDiscount" ADD CONSTRAINT "OrderDiscount_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OrderDiscount" ADD CONSTRAINT "OrderDiscount_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
