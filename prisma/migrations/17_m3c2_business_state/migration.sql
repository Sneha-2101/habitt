-- AlterTable
-- The business is in Punjab, so Kerala was only ever the wrong default added by migration 16.
ALTER TABLE "SiteSettings" ALTER COLUMN "businessState" DROP DEFAULT;

UPDATE "SiteSettings" SET "businessState" = NULL WHERE "businessState" = 'Kerala';
