"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireStaff } from "@/lib/guards";
import { revalidatePath } from "next/cache";
import { getSettings, type UpdateSiteSettingsInput } from "@/lib/settings";

export type { UpdateSiteSettingsInput };

const optionalPhoneSchema = z
  .string()
  .nullish()
  .transform((val) => {
    if (!val || !val.trim()) return null;
    let clean = val.replace(/\s+/g, "").replace(/-/g, "");
    if (clean.startsWith("+91")) clean = clean.substring(3);
    else if (clean.startsWith("91") && clean.length === 12) clean = clean.substring(2);
    else if (clean.startsWith("0") && clean.length === 11) clean = clean.substring(1);
    return clean;
  })
  .refine((val) => val === null || /^\d{10}$/.test(val), {
    message: "Must be a valid 10-digit Indian mobile number",
  });

const optionalPincodeSchema = z
  .string()
  .nullish()
  .transform((val) => (val?.trim() ? val.trim() : null))
  .refine((val) => val === null || /^\d{6}$/.test(val), {
    message: "Business pincode must be a 6-digit number",
  });

const settingsSchema = z.object({
  codEnabled: z.boolean().optional(),
  codOrderCap: z.number().int().min(0).optional(),
  shippingFee: z.number().int().min(0).optional(),
  freeShippingThreshold: z.number().int().min(0).optional(),
  codFeeEnabled: z.boolean().optional(),
  codFee: z.number().int().min(0).optional(),
  gstEnabled: z.boolean().optional(),
  gstRate: z.number().min(0).optional(),
  gstin: z.string().nullish(),
  businessName: z.string().trim().min(1, "Business name is required").optional(),
  businessTagline: z.string().trim().optional(),
  supportEmail: z.string().trim().email("Invalid support email address").optional(),
  orderSenderEmail: z.string().trim().email("Invalid order sender email address").optional(),
  businessAddress: z.string().nullish(),
  lowStockThreshold: z.number().int().min(0).optional(),
  welcomeCouponCode: z.string().trim().optional(),
  welcomeCouponPercent: z.number().int().min(0).max(100).optional(),
  birthdayDiscountPercent: z.number().int().min(0).max(100).optional(),
  returnWindowDays: z.number().int().min(0).optional(),
  abandonedCartDelayHours: z.number().int().min(1).optional(),
  freeShippingOnPrepaid: z.boolean().optional(),
  codRequiresDeliveredOrder: z.boolean().optional(),
  freeReturnShipping: z.boolean().optional(),
  refundProcessingHours: z
    .number()
    .int("Refund processing hours must be an integer")
    .min(1, "Refund processing hours must be between 1 and 240")
    .max(240, "Refund processing hours must be between 1 and 240")
    .optional(),
  maxDeliveryDays: z
    .number()
    .int("Max delivery days must be an integer")
    .min(1, "Max delivery days must be between 1 and 60")
    .max(60, "Max delivery days must be between 1 and 60")
    .optional(),
  legalName: z.string().nullish(),
  businessPhone: optionalPhoneSchema,
  businessState: z.string().nullish(),
  businessPincode: optionalPincodeSchema,
  whatsappSupportNumber: optionalPhoneSchema,
  shiprocketPickupLocation: z.string().trim().min(1).optional(),
});

export async function updateSettings(data: UpdateSiteSettingsInput) {
  await requireStaff();

  const parseResult = settingsSchema.safeParse(data);
  if (!parseResult.success) {
    const errorMsg = parseResult.error.errors.map((e) => e.message).join(", ");
    throw new Error(errorMsg || "Invalid settings input.");
  }

  const validated = parseResult.data;
  const current = await getSettings();

  const updated = await prisma.siteSettings.update({
    where: { id: "default" },
    data: {
      codEnabled: validated.codEnabled !== undefined ? validated.codEnabled : current.codEnabled,
      codOrderCap: validated.codOrderCap !== undefined ? validated.codOrderCap : current.codOrderCap,
      shippingFee: validated.shippingFee !== undefined ? validated.shippingFee : current.shippingFee,
      freeShippingThreshold: validated.freeShippingThreshold !== undefined ? validated.freeShippingThreshold : current.freeShippingThreshold,
      codFeeEnabled: validated.codFeeEnabled !== undefined ? validated.codFeeEnabled : current.codFeeEnabled,
      codFee: validated.codFee !== undefined ? validated.codFee : current.codFee,
      gstEnabled: validated.gstEnabled !== undefined ? validated.gstEnabled : current.gstEnabled,
      gstRate: validated.gstRate !== undefined ? validated.gstRate : current.gstRate,
      gstin: validated.gstin !== undefined ? (validated.gstin?.trim() || null) : current.gstin,
      businessName: validated.businessName !== undefined ? validated.businessName.trim() : current.businessName,
      businessTagline: validated.businessTagline !== undefined ? validated.businessTagline.trim() : current.businessTagline,
      supportEmail: validated.supportEmail !== undefined ? validated.supportEmail.trim() : current.supportEmail,
      orderSenderEmail: validated.orderSenderEmail !== undefined ? validated.orderSenderEmail.trim() : current.orderSenderEmail,
      businessAddress: validated.businessAddress !== undefined ? (validated.businessAddress?.trim() || null) : current.businessAddress,
      lowStockThreshold: validated.lowStockThreshold !== undefined ? validated.lowStockThreshold : current.lowStockThreshold,
      welcomeCouponCode: validated.welcomeCouponCode !== undefined ? validated.welcomeCouponCode.trim().toUpperCase() : current.welcomeCouponCode,
      welcomeCouponPercent: validated.welcomeCouponPercent !== undefined ? validated.welcomeCouponPercent : current.welcomeCouponPercent,
      birthdayDiscountPercent: validated.birthdayDiscountPercent !== undefined ? validated.birthdayDiscountPercent : current.birthdayDiscountPercent,
      returnWindowDays: validated.returnWindowDays !== undefined ? validated.returnWindowDays : current.returnWindowDays,
      abandonedCartDelayHours: validated.abandonedCartDelayHours !== undefined ? validated.abandonedCartDelayHours : current.abandonedCartDelayHours,
      freeShippingOnPrepaid: validated.freeShippingOnPrepaid !== undefined ? validated.freeShippingOnPrepaid : current.freeShippingOnPrepaid,
      codRequiresDeliveredOrder: validated.codRequiresDeliveredOrder !== undefined ? validated.codRequiresDeliveredOrder : current.codRequiresDeliveredOrder,
      freeReturnShipping: validated.freeReturnShipping !== undefined ? validated.freeReturnShipping : current.freeReturnShipping,
      refundProcessingHours: validated.refundProcessingHours !== undefined ? validated.refundProcessingHours : current.refundProcessingHours,
      maxDeliveryDays: validated.maxDeliveryDays !== undefined ? validated.maxDeliveryDays : current.maxDeliveryDays,
      legalName: validated.legalName !== undefined ? (validated.legalName?.trim() || null) : current.legalName,
      businessPhone: validated.businessPhone !== undefined ? validated.businessPhone : current.businessPhone,
      businessState: validated.businessState !== undefined ? (validated.businessState?.trim() || null) : current.businessState,
      businessPincode: validated.businessPincode !== undefined ? validated.businessPincode : current.businessPincode,
      whatsappSupportNumber: validated.whatsappSupportNumber !== undefined ? validated.whatsappSupportNumber : current.whatsappSupportNumber,
      shiprocketPickupLocation: validated.shiprocketPickupLocation !== undefined ? validated.shiprocketPickupLocation.trim() : current.shiprocketPickupLocation,
    },
  });

  revalidatePath("/admin/settings");
  revalidatePath("/checkout");
  revalidatePath("/shop");
  revalidatePath("/");
  revalidatePath("/policies/returns");
  revalidatePath("/policies/shipping");
  revalidatePath("/support");
  return updated;
}
