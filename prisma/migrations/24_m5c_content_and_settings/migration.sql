-- M5c: HomeBanner, SiteContent, and missing SiteSettings profile columns
-- Additive, idempotent-safe migration

CREATE TABLE IF NOT EXISTS "HomeBanner" (
    "id" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "imageAlt" TEXT NOT NULL,
    "heading" TEXT NOT NULL,
    "subheading" TEXT,
    "ctaLabel" TEXT,
    "ctaHref" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HomeBanner_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "HomeBanner_isActive_sortOrder_idx" ON "HomeBanner"("isActive", "sortOrder");

CREATE TABLE IF NOT EXISTS "SiteContent" (
    "key" TEXT NOT NULL,
    "title" TEXT,
    "body" TEXT NOT NULL DEFAULT '',
    "isPublished" BOOLEAN NOT NULL DEFAULT true,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteContent_pkey" PRIMARY KEY ("key")
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'SiteContent_updatedById_fkey'
    ) THEN
        ALTER TABLE "SiteContent"
        ADD CONSTRAINT "SiteContent_updatedById_fkey"
        FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

ALTER TABLE "SiteSettings" ADD COLUMN IF NOT EXISTS "businessAddressLine1" TEXT;
ALTER TABLE "SiteSettings" ADD COLUMN IF NOT EXISTS "businessAddressLine2" TEXT;
ALTER TABLE "SiteSettings" ADD COLUMN IF NOT EXISTS "businessCity" TEXT;
ALTER TABLE "SiteSettings" ADD COLUMN IF NOT EXISTS "pickupAddressLine1" TEXT;
ALTER TABLE "SiteSettings" ADD COLUMN IF NOT EXISTS "pickupAddressLine2" TEXT;
ALTER TABLE "SiteSettings" ADD COLUMN IF NOT EXISTS "pickupCity" TEXT;
ALTER TABLE "SiteSettings" ADD COLUMN IF NOT EXISTS "pickupPincode" TEXT;
ALTER TABLE "SiteSettings" ADD COLUMN IF NOT EXISTS "pickupPhone" TEXT;
ALTER TABLE "SiteSettings" ADD COLUMN IF NOT EXISTS "ordersEmail" TEXT;
ALTER TABLE "SiteSettings" ADD COLUMN IF NOT EXISTS "replyToEmail" TEXT;
ALTER TABLE "SiteSettings" ADD COLUMN IF NOT EXISTS "dispatchHandlingNote" TEXT;
ALTER TABLE "SiteSettings" ADD COLUMN IF NOT EXISTS "instagramUrl" TEXT;
ALTER TABLE "SiteSettings" ADD COLUMN IF NOT EXISTS "facebookUrl" TEXT;
