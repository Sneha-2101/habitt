"use server";

import { z } from "zod";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { requireStaff, requireRole } from "@/lib/guards";
import { writeAudit } from "@/lib/audit";
import { revalidatePath } from "next/cache";
import { GstFeeMode, Prisma } from "@prisma/client";
import { issueInvoiceForOrder } from "@/lib/gst/issue-invoice";
import { createCreditNoteForRefund } from "@/lib/gst/credit-note";
import { normalizeState } from "@/lib/gst/states";

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
  businessState: z
    .string()
    .trim()
    .nullish()
    .transform((val) => (val && val.length > 0 ? val : null)),
});

export type UpdateGstSettingsInput = z.infer<typeof gstSettingsSchema>;

export async function updateGstSettings(data: UpdateGstSettingsInput) {
  const user = await requireStaff();
  await requireRole("OWNER");
  const parsed = gstSettingsSchema.parse(data);

  const currentSettings = await prisma.siteSettings.findUnique({ where: { id: "default" } });

  // If gstEnabled is true (or being set to true):
  if (parsed.gstEnabled) {
    const missing: string[] = [];

    // 1. gstin is present and a valid 15-char Indian GSTIN
    if (!parsed.gstin || !gstinRegex.test(parsed.gstin)) {
      missing.push("a valid 15-character Indian GSTIN");
    }

    // 2. businessState is present and is a non-empty string that matches one of the recognized Indian states/UTs
    const normState = normalizeState(parsed.businessState);
    if (!parsed.businessState || !normState) {
      missing.push("a recognized Indian state/UT for business state");
    }

    // 3. businessName (or legal business name from settings) is non-empty
    const businessName = currentSettings?.businessName?.trim() || currentSettings?.legalName?.trim();
    if (!businessName) {
      missing.push("a non-empty business legal name");
    }

    // 4. At least ONE active GstRule exists in the database
    const activeRulesCount = await prisma.gstRule.count({ where: { active: true } });
    if (activeRulesCount === 0) {
      missing.push("at least one active GST rule");
    }

    if (missing.length > 0) {
      throw new Error(`Cannot enable GST. Missing required configuration: ${missing.join(", ")}`);
    }
  }

  // If gstEnabled is currently true: refuse an update that clears businessState or sets it to invalid,
  // UNLESS gstEnabled is simultaneously set to false.
  if (currentSettings?.gstEnabled && parsed.gstEnabled !== false) {
    const normState = normalizeState(parsed.businessState);
    if (!parsed.businessState || !normState) {
      throw new Error("Cannot clear or set invalid business state while GST is enabled");
    }
  }

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
      businessState: parsed.businessState ? (normalizeState(parsed.businessState)?.name ?? parsed.businessState) : null,
    },
    update: {
      gstEnabled: parsed.gstEnabled,
      gstRate: parsed.gstRate,
      gstin: parsed.gstin,
      gstFeeMode: parsed.gstFeeMode,
      gstFeeRate: parsed.gstFeeRate,
      invoicePrefix: parsed.invoicePrefix,
      businessState: parsed.businessState ? (normalizeState(parsed.businessState)?.name ?? parsed.businessState) : null,
    },
  });

  const changedFields: Record<string, { before: unknown; after: unknown }> = {};
  const fieldsToCheck = [
    "gstEnabled",
    "gstRate",
    "gstin",
    "gstFeeMode",
    "gstFeeRate",
    "invoicePrefix",
    "businessState",
  ] as const;

  for (const field of fieldsToCheck) {
    const beforeVal = currentSettings ? currentSettings[field] : null;
    const afterVal = updated[field];
    const bNorm = beforeVal === undefined ? null : beforeVal;
    const aNorm = afterVal === undefined ? null : afterVal;
    if (bNorm !== aNorm) {
      changedFields[field] = {
        before:
          field === "gstin" && typeof bNorm === "string"
            ? (bNorm.length > 4 ? `***${bNorm.slice(-4)}` : bNorm)
            : typeof bNorm === "string" && bNorm.length > 200
            ? bNorm.substring(0, 200) + "..."
            : bNorm,
        after:
          field === "gstin" && typeof aNorm === "string"
            ? (aNorm.length > 4 ? `***${aNorm.slice(-4)}` : aNorm)
            : typeof aNorm === "string" && aNorm.length > 200
            ? aNorm.substring(0, 200) + "..."
            : aNorm,
      };
    }
  }

  if (Object.keys(changedFields).length > 0) {
    await writeAudit({
      actorId: user.id,
      action: "GST_SETTINGS_UPDATE",
      entity: "SiteSettings",
      entityId: "default",
      meta: {
        changes: changedFields as unknown as Prisma.InputJsonValue,
        changedKeys: Object.keys(changedFields),
      },
    });
  }

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

  if (data.active === false && rule.active) {
    const settings = await prisma.siteSettings.findUnique({ where: { id: "default" } });
    if (settings?.gstEnabled) {
      const activeCount = await prisma.gstRule.count({ where: { active: true } });
      if (activeCount <= 1) {
        throw new Error("Cannot delete/deactivate last active rule while GST is enabled");
      }
    }
  }

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

  if (rule.active) {
    const settings = await prisma.siteSettings.findUnique({ where: { id: "default" } });
    if (settings?.gstEnabled) {
      const activeCount = await prisma.gstRule.count({ where: { active: true } });
      if (activeCount <= 1) {
        throw new Error("Cannot delete/deactivate last active rule while GST is enabled");
      }
    }
  }

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

  const settings = await prisma.siteSettings.findUnique({ where: { id: "default" } });
  if (settings?.gstEnabled) {
    const rule = await prisma.gstRule.findUnique({ where: { id } });
    if (rule?.active) {
      const activeCount = await prisma.gstRule.count({ where: { active: true } });
      if (activeCount <= 1) {
        throw new Error("Cannot delete/deactivate last active rule while GST is enabled");
      }
    }
  }

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

const partialCreditNoteSchema = z.object({
  orderId: z.string().min(1, "Order ID is required"),
  items: z
    .array(
      z.object({
        orderItemId: z.string().min(1, "Order item ID is required"),
        qty: z.number().int().min(0, "Quantity must be >= 0"),
      })
    )
    .min(1, "At least one item must be specified"),
  includeFeeShare: z.boolean().optional(),
  reason: z.string().trim().min(1, "Reason is required"),
});

export type CreatePartialCreditNoteInput = z.infer<typeof partialCreditNoteSchema>;

export async function createPartialCreditNoteAction(data: CreatePartialCreditNoteInput) {
  const user = await requireStaff();
  const parsed = partialCreditNoteSchema.parse(data);

  const invoice = await prisma.invoice.findUnique({
    where: { orderId: parsed.orderId },
    include: {
      lines: true,
      creditNotes: {
        include: { lines: true },
      },
    },
  });

  if (!invoice) {
    throw new Error("No invoice found for this order. Credit notes can only be issued against an existing invoice.");
  }

  if (invoice.mode === "RECEIPT") {
    throw new Error("Cannot issue a credit note for an order with a Receipt. Credit notes are only issued for Tax Invoices.");
  }

  const itemsToCredit = parsed.items.filter((i) => i.qty > 0);
  if (itemsToCredit.length === 0) {
    throw new Error("At least one item must have a quantity greater than 0.");
  }

  for (const item of itemsToCredit) {
    const line = invoice.lines.find((l) => l.orderItemId === item.orderItemId && l.kind === "GOODS");
    if (!line) {
      throw new Error(`Invoice goods line not found for order item ${item.orderItemId}`);
    }
    const alreadyCreditedQty = invoice.creditNotes.reduce((sum, cn) => {
      const cl = cn.lines.find((l) => l.invoiceLineId === line.id);
      return sum + (cl ? cl.qty : 0);
    }, 0);
    const remainingQty = line.qty - alreadyCreditedQty;
    if (item.qty > remainingQty) {
      throw new Error(
        `Requested credit quantity (${item.qty}) exceeds remaining uncredited quantity (${remainingQty}) for ${line.description}`
      );
    }
  }

  const alreadyCreditedTotal = invoice.creditNotes.reduce((sum, cn) => sum + cn.totalPaise, 0);
  const remainingCreditable = Math.max(0, invoice.totalPaise - alreadyCreditedTotal);
  if (remainingCreditable <= 0) {
    throw new Error("Invoice has already been fully credited.");
  }

  const refundRef = `manual-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;

  const creditNote = await prisma.$transaction(async (tx) => {
    return createCreditNoteForRefund(tx, {
      orderId: parsed.orderId,
      reason: parsed.reason,
      refundRef,
      refundedItems: itemsToCredit,
      includeFeeShare: parsed.includeFeeShare,
    });
  });

  if (!creditNote) {
    throw new Error("Failed to create credit note. Remaining creditable amount may be 0.");
  }

  await writeAudit({
    actorId: user.id,
    action: "CREDIT_NOTE_CREATE_PARTIAL",
    entity: "CreditNote",
    entityId: creditNote.id,
    meta: {
      orderId: parsed.orderId,
      refundRef,
      totalPaise: creditNote.totalPaise,
      items: parsed.items,
      reason: parsed.reason,
    },
  });

  revalidatePath(`/admin/orders/${parsed.orderId}`);
  return { success: true, creditNote };
}
