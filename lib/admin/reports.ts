import { prisma } from "@/lib/prisma";
import { ForbiddenError } from "@/lib/guards";

export const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000; // +05:30 in milliseconds

/**
 * Converts a UTC Date into an IST string YYYY-MM-DD
 */
export function formatIstDate(date: Date): string {
  const istDate = new Date(date.getTime() + IST_OFFSET_MS);
  return istDate.toISOString().slice(0, 10);
}

/**
 * Parses from and to date strings (YYYY-MM-DD) or Dates into exact UTC boundaries
 * matching the full IST days (00:00:00.000 IST to 23:59:59.999 IST).
 * Defaults to the last 30 IST days if omitted.
 */
export function parseIstDateRange(
  from?: string | Date | null,
  to?: string | Date | null
): { fromUtc: Date; toUtc: Date; fromIst: string; toIst: string } {
  const now = new Date();
  const currentIstStr = formatIstDate(now);

  let fromStr: string;
  let toStr: string;

  if (typeof from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(from)) {
    fromStr = from;
  } else if (from instanceof Date) {
    fromStr = formatIstDate(from);
  } else {
    // 30 days prior in IST
    const pastDate = new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000);
    fromStr = formatIstDate(pastDate);
  }

  if (typeof to === "string" && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
    toStr = to;
  } else if (to instanceof Date) {
    toStr = formatIstDate(to);
  } else {
    toStr = currentIstStr;
  }

  const [fromY, fromM, fromD] = fromStr.split("-").map(Number);
  const fromUtc = new Date(Date.UTC(fromY, fromM - 1, fromD, 0, 0, 0, 0) - IST_OFFSET_MS);

  const [toY, toM, toD] = toStr.split("-").map(Number);
  const toUtc = new Date(Date.UTC(toY, toM - 1, toD, 23, 59, 59, 999) - IST_OFFSET_MS);

  return { fromUtc, toUtc, fromIst: fromStr, toIst: toStr };
}

export interface DailySalesSummary {
  date: string;
  orders: number;
  grossPaise: number;
  discountPaise: number;
  shippingCodFeesPaise: number;
  refundsPaise: number;
  netPaise: number;
}

export interface SalesReportResult {
  from: string;
  to: string;
  daily: DailySalesSummary[];
  total: {
    orders: number;
    grossPaise: number;
    discountPaise: number;
    shippingCodFeesPaise: number;
    refundsPaise: number;
    netPaise: number;
  };
}

/**
 * Sales report: per day and total: orders, gross, discounts, shipping/COD fees, refunds, net.
 * Counts only paid orders (Razorpay PAID, COD DELIVERED+PAID); excludes CANCELLED/FAILED.
 */
export async function salesReport(
  from?: string | Date | null,
  to?: string | Date | null
): Promise<SalesReportResult> {
  const { fromUtc, toUtc, fromIst, toIst } = parseIstDateRange(from, to);

  const orders = await prisma.order.findMany({
    where: {
      createdAt: { gte: fromUtc, lte: toUtc },
      fulfilmentStatus: { not: "CANCELLED" },
      OR: [
        {
          paymentMethod: "RAZORPAY",
          paymentStatus: { in: ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"] },
        },
        {
          paymentMethod: "COD",
          fulfilmentStatus: "DELIVERED",
          paymentStatus: { in: ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"] },
        },
      ],
    },
    include: {
      items: true,
      refunds: true,
      discounts: true,
    },
    orderBy: { createdAt: "asc" },
  });

  const dailyMap = new Map<string, DailySalesSummary>();

  for (const o of orders) {
    const day = formatIstDate(o.createdAt);
    if (!dailyMap.has(day)) {
      dailyMap.set(day, {
        date: day,
        orders: 0,
        grossPaise: 0,
        discountPaise: 0,
        shippingCodFeesPaise: 0,
        refundsPaise: 0,
        netPaise: 0,
      });
    }

    const row = dailyMap.get(day)!;
    row.orders += 1;

    // Gross: subtotal before discount
    const gross = o.items.reduce((sum, it) => sum + it.unitPrice * it.qty, 0);
    const disc = o.discounts.reduce((sum, d) => sum + d.amountPaise, 0);
    const fees = o.shippingFee + (o.codFee || 0);
    const orderRefunds = o.refunds
      .filter((r) => r.status === "PROCESSED")
      .reduce((s, r) => s + r.amountPaise, 0);

    row.grossPaise += gross;
    row.discountPaise += disc;
    row.shippingCodFeesPaise += fees;
    row.refundsPaise += orderRefunds;
    row.netPaise += gross - disc + fees - orderRefunds;
  }

  const daily = Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date));

  const total = daily.reduce(
    (acc, d) => {
      acc.orders += d.orders;
      acc.grossPaise += d.grossPaise;
      acc.discountPaise += d.discountPaise;
      acc.shippingCodFeesPaise += d.shippingCodFeesPaise;
      acc.refundsPaise += d.refundsPaise;
      acc.netPaise += d.netPaise;
      return acc;
    },
    {
      orders: 0,
      grossPaise: 0,
      discountPaise: 0,
      shippingCodFeesPaise: 0,
      refundsPaise: 0,
      netPaise: 0,
    }
  );

  return { from: fromIst, to: toIst, daily, total };
}

export interface GstRateSummary {
  ratePercent: number;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  totalTaxPaise: number;
  netPaise: number;
}

export interface GstSummaryResult {
  from: string;
  to: string;
  taxInvoiceCount: number;
  receiptCount: number;
  rates: GstRateSummary[];
  creditNotes: Array<{
    id: string;
    creditNoteNumber: string;
    invoiceNumber: string;
    date: string;
    totalPaise: number;
    totalTaxPaise: number;
  }>;
  total: {
    taxablePaise: number;
    cgstPaise: number;
    sgstPaise: number;
    igstPaise: number;
    totalTaxPaise: number;
    netPaise: number;
  };
}

/**
 * GST Summary: from Invoice/InvoiceLine minus CreditNote/CreditNoteLine.
 * Taxable, CGST, SGST, IGST per rate; separate tax-invoice vs receipt-mode counts;
 * credit notes listed separately.
 */
export async function gstSummary(
  from?: string | Date | null,
  to?: string | Date | null
): Promise<GstSummaryResult> {
  const { fromUtc, toUtc, fromIst, toIst } = parseIstDateRange(from, to);

  const invoices = await prisma.invoice.findMany({
    where: {
      issuedAt: { gte: fromUtc, lte: toUtc },
    },
    include: {
      lines: true,
      creditNotes: {
        include: { lines: true },
      },
    },
    orderBy: { issuedAt: "asc" },
  });

  let taxInvoiceCount = 0;
  let receiptCount = 0;

  const rateMap = new Map<number, GstRateSummary>();

  const getRateRow = (rate: number): GstRateSummary => {
    if (!rateMap.has(rate)) {
      rateMap.set(rate, {
        ratePercent: rate,
        taxablePaise: 0,
        cgstPaise: 0,
        sgstPaise: 0,
        igstPaise: 0,
        totalTaxPaise: 0,
        netPaise: 0,
      });
    }
    return rateMap.get(rate)!;
  };

  const creditNotesList: GstSummaryResult["creditNotes"] = [];

  for (const inv of invoices) {
    if (inv.mode === "TAX") {
      taxInvoiceCount += 1;
    } else {
      receiptCount += 1;
    }

    // Add invoice lines
    for (const l of inv.lines) {
      const r = Number(l.ratePercent);
      const row = getRateRow(r);
      row.taxablePaise += l.taxablePaise;
      row.cgstPaise += l.cgstPaise;
      row.sgstPaise += l.sgstPaise;
      row.igstPaise += l.igstPaise;
      row.totalTaxPaise += l.cgstPaise + l.sgstPaise + l.igstPaise;
      row.netPaise += l.unitPaise * l.qty;
    }

    // Deduct credit notes lines
    for (const cn of inv.creditNotes) {
      const totalTax = cn.cgstPaise + cn.sgstPaise + cn.igstPaise;
      creditNotesList.push({
        id: cn.id,
        creditNoteNumber: cn.number,
        invoiceNumber: inv.number || "",
        date: formatIstDate(cn.issuedAt),
        totalPaise: cn.totalPaise,
        totalTaxPaise: totalTax,
      });

      for (const cl of cn.lines) {
        const r = Number(cl.ratePercent);
        const row = getRateRow(r);
        row.taxablePaise -= cl.taxablePaise;
        row.cgstPaise -= cl.cgstPaise;
        row.sgstPaise -= cl.sgstPaise;
        row.igstPaise -= cl.igstPaise;
        row.totalTaxPaise -= cl.cgstPaise + cl.sgstPaise + cl.igstPaise;
        row.netPaise -= cl.totalPaise;
      }
    }
  }

  const rates = Array.from(rateMap.values()).sort((a, b) => b.ratePercent - a.ratePercent);

  const total = rates.reduce(
    (acc, r) => {
      acc.taxablePaise += r.taxablePaise;
      acc.cgstPaise += r.cgstPaise;
      acc.sgstPaise += r.sgstPaise;
      acc.igstPaise += r.igstPaise;
      acc.totalTaxPaise += r.totalTaxPaise;
      acc.netPaise += r.netPaise;
      return acc;
    },
    {
      taxablePaise: 0,
      cgstPaise: 0,
      sgstPaise: 0,
      igstPaise: 0,
      totalTaxPaise: 0,
      netPaise: 0,
    }
  );

  return {
    from: fromIst,
    to: toIst,
    taxInvoiceCount,
    receiptCount,
    rates,
    creditNotes: creditNotesList,
    total,
  };
}

export interface ReturnsReportResult {
  from: string;
  to: string;
  requests: number;
  approved: number;
  received: number;
  refunded: number;
  refundTotalPaise: number;
  avgApprovalToRefundHours: number;
  slaBreaches: number;
  topReasonCodes: Array<{ code: string; count: number }>;
}

/**
 * Returns Report: requests, approved, received, refunded, refund total,
 * avg approval-to-refund hours, SLA breaches, top reason codes.
 */
export async function returnsReport(
  from?: string | Date | null,
  to?: string | Date | null
): Promise<ReturnsReportResult> {
  const { fromUtc, toUtc, fromIst, toIst } = parseIstDateRange(from, to);

  const [returnRequests, settings] = await Promise.all([
    prisma.returnRequest.findMany({
      where: {
        createdAt: { gte: fromUtc, lte: toUtc },
      },
      include: {
        refunds: true,
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.siteSettings.findUnique({ where: { id: "default" } }),
  ]);

  const slaHours = settings?.refundProcessingHours || 48;

  let approvedCount = 0;
  let receivedCount = 0;
  let refundedCount = 0;
  let refundTotalPaise = 0;
  let totalApprovalToRefundHours = 0;
  let completedRefundDurationCount = 0;
  let slaBreaches = 0;

  const reasonMap = new Map<string, number>();

  for (const r of returnRequests) {
    reasonMap.set(r.reasonCode, (reasonMap.get(r.reasonCode) || 0) + 1);

    if (["APPROVED", "RECEIVED", "REFUNDED"].includes(r.status)) {
      approvedCount += 1;
    }
    if (["RECEIVED", "REFUNDED"].includes(r.status)) {
      receivedCount += 1;
    }
    if (r.status === "REFUNDED") {
      refundedCount += 1;
      const refSum = r.refunds
        .filter((rf) => rf.status === "PROCESSED")
        .reduce((sum, rf) => sum + rf.amountPaise, 0);
      refundTotalPaise += refSum;

      // Approval to refund duration
      const approvedTime = r.updatedAt ? r.updatedAt.getTime() : r.createdAt.getTime();
      const firstProcessed = r.refunds.find((rf) => rf.status === "PROCESSED");
      if (firstProcessed) {
        const refundTime = firstProcessed.createdAt.getTime();
        const durationHours = Math.max(0, (refundTime - approvedTime) / (1000 * 60 * 60));
        totalApprovalToRefundHours += durationHours;
        completedRefundDurationCount += 1;
        if (durationHours > slaHours) {
          slaBreaches += 1;
        }
      }
    }
  }

  const avgApprovalToRefundHours =
    completedRefundDurationCount > 0
      ? Math.round((totalApprovalToRefundHours / completedRefundDurationCount) * 10) / 10
      : 0;

  const topReasonCodes = Array.from(reasonMap.entries())
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count);

  return {
    from: fromIst,
    to: toIst,
    requests: returnRequests.length,
    approved: approvedCount,
    received: receivedCount,
    refunded: refundedCount,
    refundTotalPaise,
    avgApprovalToRefundHours,
    slaBreaches,
    topReasonCodes,
  };
}

export interface StockVariantItem {
  variantId: string;
  productId: string;
  productName: string;
  productSlug: string;
  color: string;
  size: string;
  sku: string | null;
  stock: number;
  pricePaise: number;
  costPricePaise: number | null;
  isLowStock: boolean;
  isOutOfStock: boolean;
}

export interface StockReportResult {
  lowStockThreshold: number;
  totalVariants: number;
  lowStockCount: number;
  outOfStockCount: number;
  inStockCount: number;
  totalStockUnits: number;
  totalValueListPaise: number;
  totalValueCostPaise: number | null;
  variants: StockVariantItem[];
}

/**
 * Stock report: per product/color/size stock, low-stock, out-of-stock, value at list price.
 * OWNER also sees value at cost.
 */
export async function stockReport(actorRole?: string): Promise<StockReportResult> {
  const isOwner = actorRole === "OWNER";

  const [settings, products] = await Promise.all([
    prisma.siteSettings.findUnique({ where: { id: "default" } }),
    prisma.product.findMany({
      include: {
        variants: true,
      },
      omit: { costPrice: false },
      orderBy: { name: "asc" },
    }),
  ]);

  const threshold = settings?.lowStockThreshold ?? 5;

  let totalVariants = 0;
  let lowStockCount = 0;
  let outOfStockCount = 0;
  let inStockCount = 0;
  let totalStockUnits = 0;
  let totalValueListPaise = 0;
  let totalValueCostPaise: number | null = isOwner ? 0 : null;

  const variantItems: StockVariantItem[] = [];

  for (const prod of products) {
    for (const v of prod.variants) {
      totalVariants += 1;
      totalStockUnits += v.stock;
      totalValueListPaise += v.stock * prod.price;

      if (isOwner && totalValueCostPaise !== null) {
        totalValueCostPaise += v.stock * (prod.costPrice || 0);
      }

      const isOutOfStock = v.stock === 0;
      const isLowStock = v.stock > 0 && v.stock <= threshold;

      if (isOutOfStock) outOfStockCount += 1;
      else if (isLowStock) lowStockCount += 1;
      else inStockCount += 1;

      variantItems.push({
        variantId: v.id,
        productId: prod.id,
        productName: prod.name,
        productSlug: prod.slug,
        color: v.color || "",
        size: v.size,
        sku: v.sku,
        stock: v.stock,
        pricePaise: prod.price,
        costPricePaise: isOwner ? prod.costPrice : null,
        isLowStock,
        isOutOfStock,
      });
    }
  }

  return {
    lowStockThreshold: threshold,
    totalVariants,
    lowStockCount,
    outOfStockCount,
    inStockCount,
    totalStockUnits,
    totalValueListPaise,
    totalValueCostPaise,
    variants: variantItems,
  };
}

export interface OfferReportItem {
  offerId: string;
  name: string;
  code: string;
  kind: string;
  label: string;
  redemptions: number;
  totalDiscountPaise: number;
  status: string;
}

export interface OffersUsageReportResult {
  from: string;
  to: string;
  totalRedemptions: number;
  totalDiscountPaise: number;
  offers: OfferReportItem[];
}

/**
 * Offers usage report: redemptions, discount given per offer, active status.
 */
export async function offersUsageReport(
  from?: string | Date | null,
  to?: string | Date | null
): Promise<OffersUsageReportResult> {
  const { fromUtc, toUtc, fromIst, toIst } = parseIstDateRange(from, to);

  const [offers, redemptions] = await Promise.all([
    prisma.offer.findMany({
      orderBy: { createdAt: "desc" },
    }),
    prisma.offerRedemption.findMany({
      where: {
        createdAt: { gte: fromUtc, lte: toUtc },
      },
    }),
  ]);

  const redemptionMap = new Map<string, { count: number; totalDiscountPaise: number }>();

  for (const r of redemptions) {
    if (!redemptionMap.has(r.offerId)) {
      redemptionMap.set(r.offerId, { count: 0, totalDiscountPaise: 0 });
    }
    const entry = redemptionMap.get(r.offerId)!;
    entry.count += 1;
    entry.totalDiscountPaise += r.amountPaise;
  }

  let totalRedemptions = 0;
  let totalDiscountPaise = 0;

  const offerList: OfferReportItem[] = [];

  for (const off of offers) {
    const stats = redemptionMap.get(off.id) || { count: 0, totalDiscountPaise: 0 };
    totalRedemptions += stats.count;
    totalDiscountPaise += stats.totalDiscountPaise;

    offerList.push({
      offerId: off.id,
      name: off.name,
      code: off.code || "AUTOMATIC",
      kind: off.kind,
      label: off.name,
      redemptions: stats.count,
      totalDiscountPaise: stats.totalDiscountPaise,
      status: off.active ? "ACTIVE" : "INACTIVE",
    });
  }

  offerList.sort((a, b) => b.totalDiscountPaise - a.totalDiscountPaise);

  return {
    from: fromIst,
    to: toIst,
    totalRedemptions,
    totalDiscountPaise,
    offers: offerList,
  };
}

export interface MarginReportResult {
  from: string;
  to: string;
  totalRevenuePaise: number;
  totalCostPaise: number;
  grossMarginPaise: number;
  marginPercent: number;
  items: Array<{
    productSlug: string;
    productName: string;
    unitsSold: number;
    revenuePaise: number;
    costPaise: number;
    marginPaise: number;
    marginPercent: number;
  }>;
}

/**
 * Margin report: OWNER only. Calculates order revenue vs costPrice.
 */
export async function marginReport(
  from?: string | Date | null,
  to?: string | Date | null,
  actorRole?: string
): Promise<MarginReportResult> {
  if (actorRole !== "OWNER") {
    throw new ForbiddenError("Margin reports are restricted to OWNER");
  }

  const { fromUtc, toUtc, fromIst, toIst } = parseIstDateRange(from, to);

  const orders = await prisma.order.findMany({
    where: {
      createdAt: { gte: fromUtc, lte: toUtc },
      fulfilmentStatus: { not: "CANCELLED" },
      OR: [
        { paymentMethod: "RAZORPAY", paymentStatus: { in: ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"] } },
        { paymentMethod: "COD", fulfilmentStatus: "DELIVERED", paymentStatus: { in: ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"] } },
      ],
    },
    include: {
      items: true,
    },
  });

  const productIds = Array.from(new Set(orders.flatMap((o) => o.items.map((it) => it.productId))));
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    omit: { costPrice: false },
  });
  const prodMap = new Map(products.map((p) => [p.id, p]));

  const productAggMap = new Map<
    string,
    {
      productSlug: string;
      productName: string;
      unitsSold: number;
      revenuePaise: number;
      costPaise: number;
    }
  >();

  let totalRevenuePaise = 0;
  let totalCostPaise = 0;

  for (const o of orders) {
    for (const it of o.items) {
      const prod = prodMap.get(it.productId);
      const slug = prod?.slug || it.name;
      const name = prod?.name || it.name;
      const unitCost = prod?.costPrice || 0;
      const rev = it.unitPrice * it.qty;
      const cost = unitCost * it.qty;

      totalRevenuePaise += rev;
      totalCostPaise += cost;

      if (!productAggMap.has(slug)) {
        productAggMap.set(slug, {
          productSlug: slug,
          productName: name,
          unitsSold: 0,
          revenuePaise: 0,
          costPaise: 0,
        });
      }

      const pRow = productAggMap.get(slug)!;
      pRow.unitsSold += it.qty;
      pRow.revenuePaise += rev;
      pRow.costPaise += cost;
    }
  }

  const items = Array.from(productAggMap.values())
    .map((p) => {
      const marginPaise = p.revenuePaise - p.costPaise;
      const marginPercent =
        p.revenuePaise > 0 ? Math.round((marginPaise / p.revenuePaise) * 1000) / 10 : 0;
      return {
        ...p,
        marginPaise,
        marginPercent,
      };
    })
    .sort((a, b) => b.revenuePaise - a.revenuePaise);

  const grossMarginPaise = totalRevenuePaise - totalCostPaise;
  const marginPercent =
    totalRevenuePaise > 0 ? Math.round((grossMarginPaise / totalRevenuePaise) * 1000) / 10 : 0;

  return {
    from: fromIst,
    to: toIst,
    totalRevenuePaise,
    totalCostPaise,
    grossMarginPaise,
    marginPercent,
    items,
  };
}
