"use server";

import { prisma } from "@/lib/prisma";
import { requireStaff } from "@/lib/guards";
import { revalidatePath } from "next/cache";
import { getSettings, type UpdateSiteSettingsInput } from "@/lib/settings";

export type { UpdateSiteSettingsInput };

export async function updateSettings(data: UpdateSiteSettingsInput) {
  await requireStaff();

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
