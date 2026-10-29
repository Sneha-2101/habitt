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
