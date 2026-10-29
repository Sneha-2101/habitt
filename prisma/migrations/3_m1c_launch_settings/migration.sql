-- AlterTable
ALTER TABLE "SiteSettings" ADD COLUMN     "businessPhone" TEXT,
ADD COLUMN     "businessPincode" TEXT,
ADD COLUMN     "businessState" TEXT,
ADD COLUMN     "codRequiresDeliveredOrder" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "freeReturnShipping" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "freeShippingOnPrepaid" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "legalName" TEXT,
ADD COLUMN     "maxDeliveryDays" INTEGER NOT NULL DEFAULT 7,
ADD COLUMN     "refundProcessingHours" INTEGER NOT NULL DEFAULT 48,
ADD COLUMN     "shiprocketPickupLocation" TEXT NOT NULL DEFAULT 'Primary',
ADD COLUMN     "whatsappSupportNumber" TEXT;

