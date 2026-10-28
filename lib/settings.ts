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
}

export async function getSettings() {
  let settings = await prisma.siteSettings.findUnique({
    where: { id: "default" },
  });

  if (!settings) {
    settings = await prisma.siteSettings.create({
      data: {
        id: "default",
        codEnabled: true,
        codOrderCap: 500000,
        shippingFee: 9900,
        freeShippingThreshold: 299900,
        codFeeEnabled: false,
        codFee: 0,
        gstEnabled: false,
        gstRate: 0.0,
        businessName: "habitt",
        businessTagline: "Minimalist Apparel Essentials",
        supportEmail: "support@habitt.in",
        orderSenderEmail: "orders@habitt.in",
        lowStockThreshold: 3,
        welcomeCouponCode: "WELCOME10",
        welcomeCouponPercent: 10,
        birthdayDiscountPercent: 10,
        returnWindowDays: 7,
        abandonedCartDelayHours: 24,
      },
    });
  }

  return settings;
}
