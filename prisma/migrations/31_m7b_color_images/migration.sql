-- AlterTable
ALTER TABLE "ProductImage" ADD COLUMN "color" TEXT;

-- CreateIndex
CREATE INDEX "ProductImage_productId_color_idx" ON "ProductImage"("productId", "color");
