import { prisma } from "@/lib/prisma";

export interface UpdateSiteSettingsInput {
  codEnabled?: boolean;
  codOrderCap?: number;
  shippingFee?: number;
  freeShippingThreshold?: number;
  codFeeEnabled?: boolean;
  codFee?: number;
  gstEnabled?: boolean;
  gstRate?: number;
  gstin?: string | null;
  businessName?: string;
  businessTagline?: string;
  supportEmail?: string;
  orderSenderEmail?: string;
  businessAddress?: string | null;
  lowStockThreshold?: number;
  welcomeCouponCode?: string;
  welcomeCouponPercent?: number;
  birthdayDiscountPercent?: number;
  returnWindowDays?: number;
  abandonedCartDelayHours?: number;
  freeShippingOnPrepaid?: boolean;
  codRequiresDeliveredOrder?: boolean;
  freeReturnShipping?: boolean;
  refundProcessingHours?: number;
  maxDeliveryDays?: number;
  legalName?: string | null;
  businessPhone?: string | null;
  businessState?: string | null;
  businessPincode?: string | null;
  whatsappSupportNumber?: string | null;
  shiprocketPickupLocation?: string;
  grievanceOfficerName?: string | null;
  grievanceOfficerEmail?: string | null;
  grievanceOfficerPhone?: string | null;
  grievanceOfficerAddress?: string | null;
  businessAddressLine1?: string | null;
  businessAddressLine2?: string | null;
  businessCity?: string | null;
  pickupAddressLine1?: string | null;
  pickupAddressLine2?: string | null;
  pickupCity?: string | null;
  pickupPincode?: string | null;
  pickupPhone?: string | null;
  ordersEmail?: string | null;
  replyToEmail?: string | null;
  dispatchHandlingNote?: string | null;
  instagramUrl?: string | null;
  facebookUrl?: string | null;
  seoIndexingEnabled?: boolean;
  googleSiteVerification?: string | null;
  ogDefaultImageUrl?: string | null;
}

export async function getSettings() {
  let settings = await prisma.siteSettings.findUnique({
    where: { id: "default" },
  });

  if (!settings) {
    settings = await prisma.siteSettings.create({
      data: {
        id: "default",
      },
    });
  }

  return settings;
}
