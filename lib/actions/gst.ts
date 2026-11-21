"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireStaff, requireRole } from "@/lib/guards";
import { writeAudit } from "@/lib/audit";
import { revalidatePath } from "next/cache";
import { GstFeeMode, Prisma } from "@prisma/client";
import { issueInvoiceForOrder } from "@/lib/gst/issue-invoice";
import { createCreditNoteForRefund } from "@/lib/gst/credit-note";

const gstinRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

const gstSettingsSchema = z.object({
  gstEnabled: z.boolean(),
  gstRate: z.number().min(0).max(100),
  gstin: z
    .string()
    .trim()
    .nullish()
    .transform((val) => (val && val.length > 0 ? val.toUpperCase() : null))
    .refine((val) => val === null || gstinRegex.test(val), {
      message: "GSTIN must be a valid 15-character Indian GST format (e.g. 32AAAAA0000A1Z5)",
    }),
  gstFeeMode: z.nativeEnum(GstFeeMode),
  gstFeeRate: z.number().min(0).max(100),
  invoicePrefix: z.string().trim().min(1).max(10),
  businessState: z.string().trim().min(1, "Seller business state is required"),
});

export type UpdateGstSettingsInput = z.infer<typeof gstSettingsSchema>;

export async function updateGstSettings(data: UpdateGstSettingsInput) {
  const user = await requireStaff();
  await requireRole("OWNER");
  const parsed = gstSettingsSchema.parse(data);

  const updated = await prisma.siteSettings.upsert({
    where: { id: "default" },
    create: {
      id: "default",
      gstEnabled: parsed.gstEnabled,
      gstRate: parsed.gstRate,
      gstin: parsed.gstin,
      gstFeeMode: parsed.gstFeeMode,
      gstFeeRate: parsed.gstFeeRate,
      invoicePrefix: parsed.invoicePrefix,
      businessState: parsed.businessState,
    },
    update: {
      gstEnabled: parsed.gstEnabled,
      gstRate: parsed.gstRate,
      gstin: parsed.gstin,
      gstFeeMode: parsed.gstFeeMode,
      gstFeeRate: parsed.gstFeeRate,
      invoicePrefix: parsed.invoicePrefix,
      businessState: parsed.businessState,
    },
  });

  await writeAudit({
    actorId: user.id,
    action: "GST_SETTINGS_UPDATE",
    entity: "SiteSettings",
    entityId: "default",
    meta: parsed,
  });

  revalidatePath("/admin/gst");
  revalidatePath("/admin/settings");
  return { success: true, settings: updated };
}

const gstRuleSchema = z.object({
  name: z.string().trim().min(1, "Rule name is required"),
  hsn: z
    .string()
    .trim()
    .nullish()
    .transform((val) => (val && val.length > 0 ? val : null)),
  categoryId: z
    .string()
    .trim()
    .nullish()
    .transform((val) => (val && val.length > 0 ? val : null)),
  minUnitPaise: z.number().int().min(0, "Min unit price must be >= 0"),
  maxUnitPaise: z
    .number()
    .int()
    .min(0)
    .nullish(),
  ratePercent: z.number().min(0).max(100, "Rate percent must be between 0 and 100"),
  active: z.boolean().default(true),
});

export type CreateGstRuleInput = z.infer<typeof gstRuleSchema>;

export async function createGstRule(data: CreateGstRuleInput) {
  const user = await requireStaff();
  await requireRole("OWNER");
  const parsed = gstRuleSchema.parse(data);

  if (parsed.maxUnitPaise !== null && parsed.maxUnitPaise !== undefined && parsed.maxUnitPaise <= parsed.minUnitPaise) {
    throw new Error("Max unit price must be greater than Min unit price");
  }

  const rule = await prisma.gstRule.create({
    data: {
      name: parsed.name,
      hsn: parsed.hsn,
      categoryId: parsed.categoryId,
      minUnitPaise: parsed.minUnitPaise,
      maxUnitPaise: parsed.maxUnitPaise,
      ratePercent: parsed.ratePercent,
      active: parsed.active,
    },
  });

  await writeAudit({
    actorId: user.id,
    action: "GST_RULE_CREATE",
    entity: "GstRule",
    entityId: rule.id,
    meta: { name: rule.name, ratePercent: rule.ratePercent },
  });

  revalidatePath("/admin/gst");
  return { success: true, rule };
}

export async function updateGstRule(id: string, data: Partial<CreateGstRuleInput>) {
  const user = await requireStaff();
  await requireRole("OWNER");
  const rule = await prisma.gstRule.findUnique({ where: { id } });
  if (!rule) throw new Error("GST Rule not found");

  const minUnitPaise = data.minUnitPaise ?? rule.minUnitPaise;
  const maxUnitPaise = data.maxUnitPaise !== undefined ? data.maxUnitPaise : rule.maxUnitPaise;

  if (maxUnitPaise !== null && maxUnitPaise !== undefined && maxUnitPaise <= minUnitPaise) {
    throw new Error("Max unit price must be greater than Min unit price");
  }

  const updated = await prisma.gstRule.update({
    where: { id },
    data: {
      name: data.name?.trim(),
      hsn: data.hsn !== undefined ? (data.hsn?.trim() || null) : undefined,
      categoryId: data.categoryId !== undefined ? (data.categoryId || null) : undefined,
      minUnitPaise: data.minUnitPaise,
      maxUnitPaise: data.maxUnitPaise,
      ratePercent: data.ratePercent,
      active: data.active,
    },
  });

  await writeAudit({
    actorId: user.id,
    action: "GST_RULE_UPDATE",
    entity: "GstRule",
    entityId: updated.id,
    meta: data as Prisma.InputJsonValue,
  });

  revalidatePath("/admin/gst");
  return { success: true, rule: updated };
}

export async function toggleGstRuleActive(id: string) {
  const user = await requireStaff();
  await requireRole("OWNER");
  const rule = await prisma.gstRule.findUnique({ where: { id } });
  if (!rule) throw new Error("GST Rule not found");

  const updated = await prisma.gstRule.update({
    where: { id },
    data: { active: !rule.active },
  });

  await writeAudit({
    actorId: user.id,
    action: "GST_RULE_TOGGLE",
    entity: "GstRule",
    entityId: updated.id,
    meta: { active: updated.active },
  });

  revalidatePath("/admin/gst");
  return { success: true, rule: updated };
}

export async function deleteGstRule(id: string) {
  const user = await requireStaff();
  await requireRole("OWNER");
  await prisma.gstRule.delete({ where: { id } });

  await writeAudit({
    actorId: user.id,
    action: "GST_RULE_DELETE",
    entity: "GstRule",
    entityId: id,
  });

  revalidatePath("/admin/gst");
  return { success: true };
}

export async function retryInvoiceIssueAction(orderId: string) {
  const user = await requireStaff();
  const invoice = await prisma.$transaction(async (tx) => {
    return issueInvoiceForOrder(tx, orderId);
  });

  await writeAudit({
    actorId: user.id,
    action: "RETRY_INVOICE_ISSUE",
    entity: "Order",
    entityId: orderId,
  });

  revalidatePath(`/admin/orders/${orderId}`);
  return { success: true, invoice };
}

export async function retryCreditNoteIssueAction(orderId: string, refundRef: string, reason?: string) {
  const user = await requireStaff();
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: true },
  });
  if (!order) throw new Error("Order not found");

  const creditNote = await prisma.$transaction(async (tx) => {
    return createCreditNoteForRefund(tx, {
      orderId,
      refundRef,
      reason: reason || "Manual credit note retry from admin",
      refundedItems: order.items.map((i) => ({ orderItemId: i.id, qty: i.qty })),
    });
  });

  await writeAudit({
    actorId: user.id,
    action: "RETRY_CREDIT_NOTE_ISSUE",
    entity: "Order",
    entityId: orderId,
    meta: { refundRef },
  });

  revalidatePath(`/admin/orders/${orderId}`);
  return { success: true, creditNote };
}
