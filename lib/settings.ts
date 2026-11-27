import type { SiteSettings } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { readOrBuildFallback } from "@/lib/build-safe";

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

export const DEFAULT_SITE_SETTINGS: SiteSettings = {
  id: "default",
  codEnabled: true,
  codOrderCap: 500000,
  shippingFee: 9900,
  freeShippingThreshold: 299900,
  codFeeEnabled: false,
  codFee: 0,
  gstEnabled: false,
  gstRate: 0.0,
  gstin: null,
  businessName: "habitt",
  businessTagline: "Minimalist Apparel Essentials",
  supportEmail: "",
  orderSenderEmail: "",
  businessAddress: null,
  lowStockThreshold: 3,
  welcomeCouponCode: "WELCOME10",
  welcomeCouponPercent: 10,
  birthdayDiscountPercent: 10,
  returnWindowDays: 7,
  abandonedCartDelayHours: 24,
  freeShippingOnPrepaid: true,
  codRequiresDeliveredOrder: true,
  freeReturnShipping: true,
  refundProcessingHours: 48,
  maxDeliveryDays: 7,
  legalName: null,
  businessPhone: null,
  businessState: null,
  businessPincode: null,
  whatsappSupportNumber: null,
  shiprocketPickupLocation: "Primary",
  gstFeeMode: "COMPOSITE",
  gstFeeRate: 18.0,
  invoicePrefix: "HB",
  grievanceOfficerName: null,
  grievanceOfficerEmail: null,
  grievanceOfficerPhone: null,
  grievanceOfficerAddress: null,
  businessAddressLine1: null,
  businessAddressLine2: null,
  businessCity: null,
  pickupAddressLine1: null,
  pickupAddressLine2: null,
  pickupCity: null,
  pickupPincode: null,
  pickupPhone: null,
  ordersEmail: null,
  replyToEmail: null,
  dispatchHandlingNote: null,
  instagramUrl: null,
  facebookUrl: null,
  promoCreditExpiryDays: 180,
  walletMaxPercentOfOrder: 100,
  maxAdminAdjustPaise: 500000,
  loyaltyEnabled: false,
  loyaltyEnabledAt: null,
  loyaltyModel: "FLAT_PERCENT",
  loyaltyPercentBps: 200,
  referralEnabled: false,
  referrerRewardPaise: 0,
  refereeRewardPaise: 0,
  referralMonthlyCapPerReferrer: 10,
  referralMinOrderPaise: 0,
  referralValidityDays: 90,
  seoIndexingEnabled: false,
  googleSiteVerification: null,
  ogDefaultImageUrl: null,
  influencerCookieDays: 30,
  updatedAt: new Date(0),
};

export async function getSettings(): Promise<SiteSettings> {
  return readOrBuildFallback(
    async () => {
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
    },
    DEFAULT_SITE_SETTINGS,
    "getSettings"
  );
}
