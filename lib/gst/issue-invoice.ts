import {
  Prisma,
  PrismaClient,
  InvoiceMode,
  InvoiceLineKind,
  Invoice,
  InvoiceLine,
} from "@prisma/client";
import { getIndianFinancialYear } from "@/lib/gst/financial-year";
import { formatInvoiceNumber } from "@/lib/gst/numbering";
import { computeInvoiceLines } from "@/lib/gst/tax";

type DbClient = Prisma.TransactionClient | PrismaClient;

export class InvoiceNotAllowedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvoiceNotAllowedError";
  }
}

export const ALLOWED_INVOICE_FULFILMENT_STATUSES = [
  "SHIPPED",
  "DELIVERED",
  "RTO",
] as const;

export const ALLOWED_INVOICE_PAYMENT_STATUSES = [
  "PAID",
  "COD_PENDING",
  "COD_COLLECTED",
  "PARTIALLY_REFUNDED",
  "REFUNDED",
] as const;

export function canIssueInvoice(order: {
  fulfilmentStatus: string;
  paymentStatus: string;
  shippedAt?: Date | null;
}): { allowed: boolean; reason?: string } {
  if (
    !ALLOWED_INVOICE_FULFILMENT_STATUSES.includes(
      order.fulfilmentStatus as (typeof ALLOWED_INVOICE_FULFILMENT_STATUSES)[number]
    )
  ) {
    return {
      allowed: false,
      reason: `Invoice cannot be issued for order with fulfilmentStatus: ${order.fulfilmentStatus}. Must be SHIPPED, DELIVERED, or RTO.`,
    };
  }

  if (
    !ALLOWED_INVOICE_PAYMENT_STATUSES.includes(
      order.paymentStatus as (typeof ALLOWED_INVOICE_PAYMENT_STATUSES)[number]
    )
  ) {
    return {
      allowed: false,
      reason: `Invoice cannot be issued for order with paymentStatus: ${order.paymentStatus}. Must be PAID, COD_PENDING, COD_COLLECTED, PARTIALLY_REFUNDED, or REFUNDED.`,
    };
  }

  if (!order.shippedAt) {
    return {
      allowed: false,
      reason: "Invoice cannot be issued without shipment date (shippedAt).",
    };
  }

  return { allowed: true };
}

/**
 * Issues an invoice for an order.
 * If the order already has an invoice, returns it idempotently.
 * If SiteSettings.gstEnabled is false, creates an order receipt (InvoiceMode.RECEIPT)
 * without consuming an invoice counter sequence.
 */
export async function issueInvoiceForOrder(
  tx: DbClient,
  orderId: string
): Promise<Invoice & { lines: InvoiceLine[] }> {
  const existing = await tx.invoice.findUnique({
    where: { orderId },
    include: { lines: true },
  });
  if (existing) {
    return existing;
  }

  const order = await tx.order.findUnique({
    where: { id: orderId },
    include: { items: true },
  });

  if (!order) {
    throw new Error(`Order ${orderId} not found`);
  }

  // Refuse unless allowed fulfilmentStatus and paymentStatus, and shippedAt exists
  const check = canIssueInvoice({
    fulfilmentStatus: order.fulfilmentStatus,
    paymentStatus: order.paymentStatus,
    shippedAt: order.shippedAt,
  });
  if (!check.allowed) {
    throw new InvoiceNotAllowedError(check.reason || "Invoice not allowed for this order");
  }

  if (!order.shippedAt) {
    throw new InvoiceNotAllowedError(
      "Shipment date (shippedAt) is required to determine the invoice financial year"
    );
  }

  const siteSettings = await tx.siteSettings.findUnique({
    where: { id: "default" },
  });

  const productIds = Array.from(new Set(order.items.map((i) => i.productId)));
  const products = await tx.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, categoryId: true, hsn: true },
  });
  const productMap = new Map(products.map((p) => [p.id, p]));

  const sellerName = siteSettings?.legalName?.trim() || siteSettings?.businessName?.trim() || "";
  const sellerGstin = siteSettings?.gstin || null;
  const structuredAddress = [
    siteSettings?.businessAddressLine1,
    siteSettings?.businessAddressLine2,
    siteSettings?.businessCity,
    siteSettings?.businessState,
    siteSettings?.businessPincode,
  ]
    .map((v) => v?.trim())
    .filter((v): v is string => Boolean(v))
    .join(", ");
  const sellerAddress = {
    address: structuredAddress || siteSettings?.businessAddress || "",
    phone: siteSettings?.businessPhone || "",
    email: siteSettings?.supportEmail || "",
  };
  const sellerState = siteSettings?.businessState || "";

  const rawBuyerAddr = (order.shippingAddress as Record<string, unknown>) || {};
  const buyerName =
    order.customerName || (rawBuyerAddr.fullName as string) || "Customer";
  const buyerGstin = (rawBuyerAddr.gstin as string) || null;
  const buyerAddress = rawBuyerAddr;
  const buyerState = (rawBuyerAddr.state as string) || null;

  // RECEIPT MODE
  if (!siteSettings?.gstEnabled) {
    const linesData: Prisma.InvoiceLineCreateWithoutInvoiceInput[] = [];

    for (const item of order.items) {
      const netPaise = item.unitPrice * item.qty - (item.discountPaise || 0);
      linesData.push({
        orderItem: { connect: { id: item.id } },
        kind: InvoiceLineKind.GOODS,
        description: item.color
          ? `${item.name} (${item.color} / ${item.size})`
          : `${item.name} (${item.size})`,
        hsn: productMap.get(item.productId)?.hsn || null,
        qty: item.qty,
        unitPaise: item.unitPrice,
        discountPaise: item.discountPaise || 0,
        netPaise,
        ratePercent: 0,
        taxablePaise: netPaise,
        cgstPaise: 0,
        sgstPaise: 0,
        igstPaise: 0,
      });
    }

    if (order.shippingFee > 0) {
      linesData.push({
        kind: InvoiceLineKind.SHIPPING,
        description: "Shipping Fee",
        hsn: null,
        qty: 1,
        unitPaise: order.shippingFee,
        discountPaise: 0,
        netPaise: order.shippingFee,
        ratePercent: 0,
        taxablePaise: order.shippingFee,
        cgstPaise: 0,
        sgstPaise: 0,
        igstPaise: 0,
      });
    }

    const goodsAndShippingTotal = linesData.reduce(
      (sum, l) => sum + (l.netPaise || 0),
      0
    );
    const diff = order.total - goodsAndShippingTotal;
    if (diff > 0 && order.paymentMethod === "COD") {
      linesData.push({
        kind: InvoiceLineKind.COD,
        description: "Cash on Delivery Fee",
        hsn: null,
        qty: 1,
        unitPaise: diff,
        discountPaise: 0,
        netPaise: diff,
        ratePercent: 0,
        taxablePaise: diff,
        cgstPaise: 0,
        sgstPaise: 0,
        igstPaise: 0,
      });
    }

    return tx.invoice.create({
      data: {
        orderId: order.id,
        mode: InvoiceMode.RECEIPT,
        sellerName,
        sellerAddress: sellerAddress as Prisma.InputJsonValue,
        sellerGstin: null, // Hidden in receipt mode
        sellerState,
        buyerName,
        buyerGstin,
        buyerAddress: buyerAddress as Prisma.InputJsonValue,
        buyerState,
        placeOfSupply: buyerState || "Unknown",
        totalPaise: order.total,
        taxablePaise: order.total,
        cgstPaise: 0,
        sgstPaise: 0,
        igstPaise: 0,
        isInterState: false,
        lines: { create: linesData },
      },
      include: { lines: true },
    });
  }

  // TAX INVOICE MODE
  const fy = getIndianFinancialYear(order.shippedAt!);

  // Atomic counter reservation with row lock
  await tx.$executeRaw`
    INSERT INTO "InvoiceCounter" ("fy", "lastNumber", "updatedAt")
    VALUES (${fy}, 0, NOW())
    ON CONFLICT ("fy") DO NOTHING
  `;
  const counterRows = await tx.$queryRaw<Array<{ lastNumber: number }>>`
    SELECT "lastNumber" FROM "InvoiceCounter" WHERE "fy" = ${fy} FOR UPDATE
  `;
  const nextSeq = (counterRows[0]?.lastNumber ?? 0) + 1;
  await tx.$executeRaw`
    UPDATE "InvoiceCounter"
    SET "lastNumber" = ${nextSeq}, "updatedAt" = NOW()
    WHERE "fy" = ${fy}
  `;

  const prefix = siteSettings.invoicePrefix || "HB";
  const invoiceNumber = formatInvoiceNumber(prefix, fy, nextSeq);

  const rules = await tx.gstRule.findMany({ where: { active: true } });

  const invoiceItems = order.items.map((item) => ({
    orderItemId: item.id,
    description: item.color
      ? `${item.name} (${item.color} / ${item.size})`
      : `${item.name} (${item.size})`,
    hsn: productMap.get(item.productId)?.hsn || undefined,
    categoryId: productMap.get(item.productId)?.categoryId || undefined,
    qty: item.qty,
    unitPricePaise: item.unitPrice,
    discountPaise: item.discountPaise || 0,
    isGift: item.isGift,
  }));

  const goodsNetSum = invoiceItems.reduce(
    (acc, i) => acc + (i.unitPricePaise * i.qty - i.discountPaise),
    0
  );
  const feeDiff = order.total - goodsNetSum - order.shippingFee;
  const codFeePaise = feeDiff > 0 && order.paymentMethod === "COD" ? feeDiff : 0;

  const calc = computeInvoiceLines({
    items: invoiceItems,
    shippingFeePaise: order.shippingFee,
    codFeePaise,
    feeMode: siteSettings.gstFeeMode,
    feeRatePercent: siteSettings.gstFeeRate,
    fallbackGstRatePercent: siteSettings.gstRate,
    rules: rules.map((r) => ({
      hsn: r.hsn ?? undefined,
      categoryId: r.categoryId ?? undefined,
      minUnitPaise: r.minUnitPaise,
      maxUnitPaise: r.maxUnitPaise ?? undefined,
      ratePercent: Number(r.ratePercent),
    })),
    buyerState,
    businessState: sellerState,
  });

  return tx.invoice.create({
    data: {
      orderId: order.id,
      mode: InvoiceMode.TAX,
      fy,
      number: invoiceNumber,
      prefix,
      sequence: nextSeq,
      sellerGstin,
      sellerName,
      sellerAddress: sellerAddress as Prisma.InputJsonValue,
      sellerState,
      buyerName,
      buyerGstin,
      buyerAddress: buyerAddress as Prisma.InputJsonValue,
      buyerState,
      placeOfSupply: calc.placeOfSupply,
      totalPaise: calc.totals.totalPaise,
      taxablePaise: calc.totals.taxablePaise,
      cgstPaise: calc.totals.cgstPaise,
      sgstPaise: calc.totals.sgstPaise,
      igstPaise: calc.totals.igstPaise,
      isInterState: calc.isInterState,
      lines: {
        create: calc.lines.map((l) => ({
          orderItemId: l.orderItemId,
          kind: (l.kind as InvoiceLineKind) || (l.orderItemId ? InvoiceLineKind.GOODS : InvoiceLineKind.SHIPPING),
          description: l.description,
          hsn: l.hsn,
          qty: l.qty,
          unitPaise: l.unitPaise,
          discountPaise: l.discountPaise,
          netPaise: l.totalPaise,
          ratePercent: l.ratePercent,
          taxablePaise: l.taxablePaise,
          cgstPaise: l.cgstPaise,
          sgstPaise: l.sgstPaise,
          igstPaise: l.igstPaise,
        })),
      },
    },
    include: { lines: true },
  });
}
