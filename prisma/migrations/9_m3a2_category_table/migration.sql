-- Rename existing enum Category so PostgreSQL can create table Category
ALTER TYPE "Category" RENAME TO "Category_old";

-- CreateTable Category
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "sizes" TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Category_slug_key" ON "Category"("slug");

-- Insert seed rows
INSERT INTO "Category" ("id", "slug", "name", "position", "sizes", "active", "createdAt", "updatedAt")
VALUES
    ('cat_shirts', 'shirts', 'Shirts', 0, ARRAY['S', 'M', 'L', 'XL', 'XXL'], true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('cat_overshirts', 'overshirts', 'Overshirts', 1, ARRAY['S', 'M', 'L', 'XL', 'XXL'], true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('cat_polos', 'polos', 'Polos', 2, ARRAY['S', 'M', 'L', 'XL', 'XXL'], true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('cat_trousers', 'trousers', 'Trousers', 3, ARRAY['S', 'M', 'L', 'XL', 'XXL'], true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

-- AlterTable Product: add categoryId column
ALTER TABLE "Product" ADD COLUMN "categoryId" TEXT;

-- Guard BEFORE update: RAISE EXCEPTION if any Product has a category not in the four seed categories
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM "Product"
        WHERE category::text NOT IN ('SHIRTS', 'OVERSHIRTS', 'POLOS', 'TROUSERS')
    ) THEN
        RAISE EXCEPTION 'Found Product with category outside expected 4 values';
    END IF;
END $$;

-- Backfill categoryId on Product
UPDATE "Product" SET "categoryId" = CASE category::text
    WHEN 'SHIRTS' THEN 'cat_shirts'
    WHEN 'OVERSHIRTS' THEN 'cat_overshirts'
    WHEN 'POLOS' THEN 'cat_polos'
    WHEN 'TROUSERS' THEN 'cat_trousers'
END;

-- Make categoryId NOT NULL
ALTER TABLE "Product" ALTER COLUMN "categoryId" SET NOT NULL;

-- Add Foreign Key constraint
ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Create Index on Product(categoryId)
CREATE INDEX "Product_categoryId_idx" ON "Product"("categoryId");

-- Alter ProductVariant.size and OrderItem.size to TEXT
ALTER TABLE "ProductVariant" ALTER COLUMN "size" TYPE TEXT USING "size"::text;
ALTER TABLE "OrderItem" ALTER COLUMN "size" TYPE TEXT USING "size"::text;