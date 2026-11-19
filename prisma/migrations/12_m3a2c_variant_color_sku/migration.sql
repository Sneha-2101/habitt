-- AlterTable
ALTER TABLE "ProductVariant" ADD COLUMN "color" TEXT NOT NULL DEFAULT '', ADD COLUMN "colorHex" TEXT, ADD COLUMN "sku" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariant_sku_key" ON "ProductVariant"("sku");

-- DropIndex
DROP INDEX "ProductVariant_productId_size_key";

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariant_productId_size_color_key" ON "ProductVariant"("productId", "size", "color");

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN "color" TEXT NOT NULL DEFAULT '', ADD COLUMN "sku" TEXT;