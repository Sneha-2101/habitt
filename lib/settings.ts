"use server";

import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { revalidatePath } from "next/cache";

async function requireStaffOrOwner() {
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (!session?.user || (role !== "STAFF" && role !== "OWNER")) {
    throw new Error("Unauthorized: Action requires STAFF or OWNER role.");
  }
  return session;
}

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

export async function updateSettings(data: UpdateSiteSettingsInput) {
  await requireStaffOrOwner();

  const current = await getSettings();

  const updated = await prisma.siteSettings.update({
    where: { id: "default" },
    data: {
      codEnabled: typeof data.codEnabled === "boolean" ? data.codEnabled : current.codEnabled,
      codOrderCap: typeof data.codOrderCap === "number" && data.codOrderCap >= 0 ? data.codOrderCap : current.codOrderCap,
      shippingFee: typeof data.shippingFee === "number" && data.shippingFee >= 0 ? data.shippingFee : current.shippingFee,
      freeShippingThreshold: typeof data.freeShippingThreshold === "number" && data.freeShippingThreshold >= 0 ? data.freeShippingThreshold : current.freeShippingThreshold,
      codFeeEnabled: typeof data.codFeeEnabled === "boolean" ? data.codFeeEnabled : current.codFeeEnabled,
      codFee: typeof data.codFee === "number" && data.codFee >= 0 ? data.codFee : current.codFee,
      gstEnabled: typeof data.gstEnabled === "boolean" ? data.gstEnabled : current.gstEnabled,
      gstRate: typeof data.gstRate === "number" && data.gstRate >= 0 ? data.gstRate : current.gstRate,
      gstin: data.gstin !== undefined ? (data.gstin?.trim() || null) : current.gstin,
      businessName: data.businessName?.trim() || current.businessName,
      businessTagline: data.businessTagline?.trim() || current.businessTagline,
      supportEmail: data.supportEmail?.trim() || current.supportEmail,
      orderSenderEmail: data.orderSenderEmail?.trim() || current.orderSenderEmail,
      businessAddress: data.businessAddress !== undefined ? (data.businessAddress?.trim() || null) : current.businessAddress,
      lowStockThreshold: typeof data.lowStockThreshold === "number" && data.lowStockThreshold >= 0 ? data.lowStockThreshold : current.lowStockThreshold,
      welcomeCouponCode: data.welcomeCouponCode?.trim().toUpperCase() || current.welcomeCouponCode,
      welcomeCouponPercent: typeof data.welcomeCouponPercent === "number" && data.welcomeCouponPercent >= 0 ? data.welcomeCouponPercent : current.welcomeCouponPercent,
      birthdayDiscountPercent: typeof data.birthdayDiscountPercent === "number" && data.birthdayDiscountPercent >= 0 ? data.birthdayDiscountPercent : current.birthdayDiscountPercent,
      returnWindowDays: typeof data.returnWindowDays === "number" && data.returnWindowDays >= 0 ? data.returnWindowDays : current.returnWindowDays,
      abandonedCartDelayHours: typeof data.abandonedCartDelayHours === "number" && data.abandonedCartDelayHours >= 0 ? data.abandonedCartDelayHours : current.abandonedCartDelayHours,
    },
  });

  revalidatePath("/admin/settings");
  revalidatePath("/checkout");
  revalidatePath("/shop");
  revalidatePath("/");
  revalidatePath("/policies/returns");
  revalidatePath("/policies/shipping");
  return updated;
}
