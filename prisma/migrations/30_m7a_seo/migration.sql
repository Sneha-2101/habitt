-- M7a: SEO Foundation, Category/Image SEO fields, ProductSlugRedirect

ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "seoTitle" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "seoDescription" TEXT;

ALTER TABLE "Category" ADD COLUMN IF NOT EXISTS "seoTitle" TEXT;
ALTER TABLE "Category" ADD COLUMN IF NOT EXISTS "seoDescription" TEXT;
ALTER TABLE "Category" ADD COLUMN IF NOT EXISTS "introText" TEXT;

ALTER TABLE "ProductImage" ADD COLUMN IF NOT EXISTS "altText" TEXT;

CREATE TABLE IF NOT EXISTS "ProductSlugRedirect" (
    "id" TEXT NOT NULL,
    "oldSlug" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductSlugRedirect_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ProductSlugRedirect_oldSlug_nonempty_check" CHECK ("oldSlug" <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProductSlugRedirect_oldSlug_key" ON "ProductSlugRedirect"("oldSlug");
CREATE INDEX IF NOT EXISTS "ProductSlugRedirect_productId_idx" ON "ProductSlugRedirect"("productId");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProductSlugRedirect_productId_fkey') THEN
        ALTER TABLE "ProductSlugRedirect"
        ADD CONSTRAINT "ProductSlugRedirect_productId_fkey"
        FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

ALTER TABLE "SiteSettings" ADD COLUMN IF NOT EXISTS "seoIndexingEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SiteSettings" ADD COLUMN IF NOT EXISTS "googleSiteVerification" TEXT;
ALTER TABLE "SiteSettings" ADD COLUMN IF NOT EXISTS "ogDefaultImageUrl" TEXT;
