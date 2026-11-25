import {
  Prisma,
  PrismaClient,
  CreditNote,
  CreditNoteLine,
  InvoiceLineKind,
} from "@prisma/client";
import { getIndianFinancialYear } from "@/lib/gst/financial-year";
import { formatCreditNoteNumber } from "@/lib/gst/numbering";
import { extractInclusiveTax, splitTax } from "@/lib/gst/tax";

type DbClient = Prisma.TransactionClient | PrismaClient;

export interface CreateCreditNoteInput {
  orderId: string;
  refundedItems?: Array<{ orderItemId: string; qty: number }>;
  refundAmountPaise?: number;
  reason: string;
  refundRef?: string;
  includeFeeShare?: boolean;
  refundShippingFee?: boolean;
  refundCodFee?: boolean;
}

export interface CreditNoteInvoiceLineInput {
  id: string;
  orderItemId: string | null;
  kind: InvoiceLineKind;
  description: string;
  qty: number;
  unitPaise: number;
  discountPaise: number;
  netPaise: number;
  ratePercent: number | Prisma.Decimal;
}

export interface CreditNoteExistingNoteInput {
  totalPaise: number;
  lines: Array<{
    invoiceLineId: string | null;
    totalPaise: number;
    qty: number;
  }>;
}

export interface CreditNoteOrderItemInput {
  id: string;
  unitPrice: number;
  discountPaise: number;
  qty: number;
}

export interface ComputeCreditNoteAmountsInput {
  invoiceTotalPaise: number;
  isInterState: boolean;
  invoiceLines: CreditNoteInvoiceLineInput[];
  existingCreditNotes: CreditNoteExistingNoteInput[];
  orderItems?: CreditNoteOrderItemInput[];
  refundedItems?: Array<{ orderItemId: string; qty: number }>;
  refundAmountPaise?: number;
  includeFeeShare?: boolean;
  refundShippingFee?: boolean;
  refundCodFee?: boolean;
}

export interface CreditNoteLineDraft {
  invoiceLineId: string;
  kind: InvoiceLineKind;
  description: string;
  qty: number;
  ratePercent: number;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  totalPaise: number;
}

export interface ComputeCreditNoteAmountsResult {
  lines: CreditNoteLineDraft[];
  totalPaise: number;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
}

/**
 * Pure calculation of credit note line amounts, fee allocation (COMPOSITE vs SEPARATE),
 * tax extraction/splitting, and cap enforcement.
 */
export function computeCreditNoteAmounts(
  input: ComputeCreditNoteAmountsInput
): ComputeCreditNoteAmountsResult | null {
  const alreadyCreditedTotal = input.existingCreditNotes.reduce(
    (sum, cn) => sum + cn.totalPaise,
    0
  );
  const remainingCreditable = Math.max(0, input.invoiceTotalPaise - alreadyCreditedTotal);
  if (remainingCreditable <= 0) {
    return null;
  }

  const draftLines: CreditNoteLineDraft[] = [];

  // Track already credited amount and quantity per invoice line
  const creditedPerLine = new Map<string, number>();
  const creditedQtyPerLine = new Map<string, number>();
  for (const cn of input.existingCreditNotes) {
    for (const cl of cn.lines) {
      if (cl.invoiceLineId) {
        creditedPerLine.set(
          cl.invoiceLineId,
          (creditedPerLine.get(cl.invoiceLineId) || 0) + cl.totalPaise
        );
        creditedQtyPerLine.set(
          cl.invoiceLineId,
          (creditedQtyPerLine.get(cl.invoiceLineId) || 0) + cl.qty
        );
      }
    }
  }

  if (input.refundedItems && input.refundedItems.length > 0) {
    const goodsLines = input.invoiceLines.filter((l) => l.kind === "GOODS");
    const feeLines = input.invoiceLines.filter((l) => l.kind !== "GOODS");
    const isComposite = feeLines.length === 0;

    // Check if after this return, all goods items in the order have been fully refunded
    const isFullGoodsRefund =
      goodsLines.length > 0 &&
      goodsLines.every((gLine) => {
        const item = input.refundedItems?.find((i) => i.orderItemId === gLine.orderItemId);
        const alreadyQty = creditedQtyPerLine.get(gLine.id) || 0;
        return alreadyQty + (item?.qty || 0) >= gLine.qty;
      });

    // Also check if this return completes the entire order return (as signalled by caller or full return)
    const isFinalReturn = Boolean(input.includeFeeShare) || isFullGoodsRefund;

    const orderItemMap = new Map<string, { unitPrice: number; discountPaise: number; qty: number }>();
    if (isComposite && input.orderItems) {
      for (const item of input.orderItems) {
        orderItemMap.set(item.id, {
          unitPrice: item.unitPrice,
          discountPaise: item.discountPaise || 0,
          qty: item.qty,
        });
      }
    }

    for (const refItem of input.refundedItems) {
      const line = input.invoiceLines.find(
        (l) => l.orderItemId === refItem.orderItemId
      );
      if (!line || line.qty <= 0) continue;

      const alreadyLine = creditedPerLine.get(line.id) || 0;
      const remainingLine = Math.max(0, line.netPaise - alreadyLine);
      if (remainingLine <= 0) continue;

      const alreadyQty = creditedQtyPerLine.get(line.id) || 0;
      const remainingQty = Math.max(0, line.qty - alreadyQty);
      if (remainingQty <= 0) continue;

      const effectiveQty = Math.min(refItem.qty, remainingQty);
      if (effectiveQty <= 0) continue;

      let lineTotal = 0;
      if (isComposite) {
        if (isFinalReturn) {
          // On final return in COMPOSITE mode: sweep all remaining balance of the line
          // (including fee share and any rounding remainder)
          lineTotal = remainingLine;
        } else {
          // On partial return in COMPOSITE mode: credit item net price only (no fee share)
          const oi = line.orderItemId ? orderItemMap.get(line.orderItemId) : null;
          const itemNetTotal = oi
            ? Math.max(0, oi.unitPrice * oi.qty - oi.discountPaise)
            : Math.max(0, line.unitPaise * line.qty - line.discountPaise);
          const ratio = Math.min(1, effectiveQty / line.qty);
          lineTotal = Math.round(itemNetTotal * ratio);
          lineTotal = Math.min(lineTotal, remainingLine);
        }
      } else {
        // SEPARATE mode or RECEIPT mode fallback
        const ratio = Math.min(1, effectiveQty / line.qty);
        lineTotal = Math.round(line.netPaise * ratio);
        lineTotal = Math.min(lineTotal, remainingLine);
      }
      if (lineTotal <= 0) continue;

      const rate = Number(line.ratePercent);
      const tax = extractInclusiveTax(lineTotal, rate);
      const split = splitTax(tax.taxPaise, input.isInterState);

      draftLines.push({
        invoiceLineId: line.id,
        kind: line.kind,
        description: `Credit: ${line.description}`,
        qty: effectiveQty,
        ratePercent: rate,
        taxablePaise: tax.taxablePaise,
        cgstPaise: split.cgstPaise,
        sgstPaise: split.sgstPaise,
        igstPaise: split.igstPaise,
        totalPaise: lineTotal,
      });

      creditedPerLine.set(line.id, alreadyLine + lineTotal);
      creditedQtyPerLine.set(line.id, alreadyQty + effectiveQty);
    }

    // In COMPOSITE mode, if isFinalReturn is true, any remaining creditable balance across
    // goods lines (e.g. from lines not in refundedItems that still have remaining fee share)
    // should be swept into draftLines so total of all credit notes equals invoice total exactly.
    if (isComposite && isFinalReturn) {
      for (const line of goodsLines) {
        const alreadyLine = creditedPerLine.get(line.id) || 0;
        const remainingLine = Math.max(0, line.netPaise - alreadyLine);
        if (remainingLine <= 0) continue;

        const existingDraft = draftLines.find((d) => d.invoiceLineId === line.id);
        if (existingDraft) {
          existingDraft.totalPaise += remainingLine;
          const rate = Number(existingDraft.ratePercent);
          const tax = extractInclusiveTax(existingDraft.totalPaise, rate);
          const split = splitTax(tax.taxPaise, input.isInterState);
          existingDraft.taxablePaise = tax.taxablePaise;
          existingDraft.cgstPaise = split.cgstPaise;
          existingDraft.sgstPaise = split.sgstPaise;
          existingDraft.igstPaise = split.igstPaise;
          creditedPerLine.set(line.id, alreadyLine + remainingLine);
        } else {
          const rate = Number(line.ratePercent);
          const tax = extractInclusiveTax(remainingLine, rate);
          const split = splitTax(tax.taxPaise, input.isInterState);
          draftLines.push({
            invoiceLineId: line.id,
            kind: line.kind,
            description: `Credit: ${line.description}`,
            qty: 0,
            ratePercent: rate,
            taxablePaise: tax.taxablePaise,
            cgstPaise: split.cgstPaise,
            sgstPaise: split.sgstPaise,
            igstPaise: split.igstPaise,
            totalPaise: remainingLine,
          });
          creditedPerLine.set(line.id, alreadyLine + remainingLine);
        }
      }
    }

    if (input.includeFeeShare || isFullGoodsRefund) {
      const goodsInvoiceNet = goodsLines.reduce((sum, l) => sum + l.netPaise, 0);
      const goodsRefundedNet = draftLines.reduce((sum, l) => sum + l.totalPaise, 0);
      const feeRatio = isFullGoodsRefund
        ? 1
        : goodsInvoiceNet > 0
        ? goodsRefundedNet / goodsInvoiceNet
        : 1;

      for (const feeLine of feeLines) {
        if (feeLine.kind === "SHIPPING" && input.refundShippingFee === false) continue;
        if (feeLine.kind === "COD" && input.refundCodFee === false) continue;

        const alreadyFee = creditedPerLine.get(feeLine.id) || 0;
        const remainingFee = Math.max(0, feeLine.netPaise - alreadyFee);
        if (remainingFee <= 0) continue;

        let feeTotal = Math.round(feeLine.netPaise * feeRatio);
        feeTotal = Math.min(feeTotal, remainingFee);
        if (feeTotal <= 0) continue;

        const rate = Number(feeLine.ratePercent);
        const tax = extractInclusiveTax(feeTotal, rate);
        const split = splitTax(tax.taxPaise, input.isInterState);

        draftLines.push({
          invoiceLineId: feeLine.id,
          kind: feeLine.kind,
          description: `Credit: ${feeLine.description}`,
          qty: 1,
          ratePercent: rate,
          taxablePaise: tax.taxablePaise,
          cgstPaise: split.cgstPaise,
          sgstPaise: split.sgstPaise,
          igstPaise: split.igstPaise,
          totalPaise: feeTotal,
        });

        creditedPerLine.set(feeLine.id, alreadyFee + feeTotal);
      }
    }
  } else {
    // Proportional credit across all invoice lines
    const targetAmount = input.refundAmountPaise
      ? Math.min(input.refundAmountPaise, remainingCreditable)
      : remainingCreditable;

    const currentCreditableTotal = input.invoiceLines.reduce((sum, line) => {
      const already = creditedPerLine.get(line.id) || 0;
      return sum + Math.max(0, line.netPaise - already);
    }, 0);

    if (currentCreditableTotal <= 0) return null;

    const scale = Math.min(1, targetAmount / currentCreditableTotal);

    for (const line of input.invoiceLines) {
      const already = creditedPerLine.get(line.id) || 0;
      const remainingLine = Math.max(0, line.netPaise - already);
      if (remainingLine <= 0) continue;

      let lineTotal = Math.round(remainingLine * scale);
      lineTotal = Math.min(lineTotal, remainingLine);
      if (lineTotal <= 0) continue;

      const rate = Number(line.ratePercent);
      const tax = extractInclusiveTax(lineTotal, rate);
      const split = splitTax(tax.taxPaise, input.isInterState);

      draftLines.push({
        invoiceLineId: line.id,
        kind: line.kind,
        description: `Credit: ${line.description}`,
        qty: line.qty,
        ratePercent: rate,
        taxablePaise: tax.taxablePaise,
        cgstPaise: split.cgstPaise,
        sgstPaise: split.sgstPaise,
        igstPaise: split.igstPaise,
        totalPaise: lineTotal,
      });

      creditedPerLine.set(line.id, already + lineTotal);
    }
  }

  // Ensure overall cap is strictly respected
  let currentSum = draftLines.reduce((s, l) => s + l.totalPaise, 0);
  if (currentSum > remainingCreditable) {
    const diff = currentSum - remainingCreditable;
    const last = draftLines[draftLines.length - 1];
    if (last && last.totalPaise > diff) {
      last.totalPaise -= diff;
      const rate = Number(last.ratePercent);
      const tax = extractInclusiveTax(last.totalPaise, rate);
      const split = splitTax(tax.taxPaise, input.isInterState);
      last.taxablePaise = tax.taxablePaise;
      last.cgstPaise = split.cgstPaise;
      last.sgstPaise = split.sgstPaise;
      last.igstPaise = split.igstPaise;
    }
    currentSum = draftLines.reduce((s, l) => s + l.totalPaise, 0);
  }

  if (draftLines.length === 0 || currentSum <= 0) {
    return null;
  }

  const totalPaise = draftLines.reduce((s, l) => s + l.totalPaise, 0);
  const taxablePaise = draftLines.reduce((s, l) => s + l.taxablePaise, 0);
  const cgstPaise = draftLines.reduce((s, l) => s + l.cgstPaise, 0);
  const sgstPaise = draftLines.reduce((s, l) => s + l.sgstPaise, 0);
  const igstPaise = draftLines.reduce((s, l) => s + l.igstPaise, 0);

  return {
    lines: draftLines,
    totalPaise,
    taxablePaise,
    cgstPaise,
    sgstPaise,
    igstPaise,
  };
}

/**
 * Creates a Credit Note for an order's refund.
 * If the order's invoice was issued in RECEIPT mode (or has no invoice), no Credit Note is issued (returns null).
 * Idempotent: returns existing Credit Note if matching refundRef is found.
 */
export async function createCreditNoteForRefund(
  tx: DbClient,
  params: CreateCreditNoteInput
): Promise<(CreditNote & { lines: CreditNoteLine[] }) | null> {
  const invoice = await tx.invoice.findUnique({
    where: { orderId: params.orderId },
    include: {
      lines: true,
      creditNotes: {
        include: { lines: true },
      },
    },
  });

  if (!invoice || invoice.mode === "RECEIPT") {
    return null;
  }

  // Idempotency check
  if (params.refundRef) {
    const existing = invoice.creditNotes.find(
      (cn) => cn.refundRef === params.refundRef
    );
    if (existing) {
      return existing;
    }
  }

  const isComposite = invoice.lines.every((l) => l.kind === "GOODS");
  let orderItems: CreditNoteOrderItemInput[] | undefined;
  if (isComposite && params.refundedItems && params.refundedItems.length > 0) {
    const order = await tx.order.findUnique({
      where: { id: params.orderId },
      include: { items: true },
    });
    if (order) {
      orderItems = order.items.map((item) => ({
        id: item.id,
        unitPrice: item.unitPrice,
        discountPaise: item.discountPaise || 0,
        qty: item.qty,
      }));
    }
  }

  const computed = computeCreditNoteAmounts({
    invoiceTotalPaise: invoice.totalPaise,
    isInterState: invoice.isInterState,
    invoiceLines: invoice.lines,
    existingCreditNotes: invoice.creditNotes,
    orderItems,
    refundedItems: params.refundedItems,
    refundAmountPaise: params.refundAmountPaise,
    includeFeeShare: params.includeFeeShare,
    refundShippingFee: params.refundShippingFee,
    refundCodFee: params.refundCodFee,
  });

  if (!computed) {
    return null;
  }

  const fy = getIndianFinancialYear(new Date());
  const counterKey = `CN-${fy}`;

  // Atomic counter update with row lock
  await tx.$executeRaw`
    INSERT INTO "InvoiceCounter" ("fy", "lastNumber", "updatedAt")
    VALUES (${counterKey}, 0, NOW())
    ON CONFLICT ("fy") DO NOTHING
  `;
  const counterRows = await tx.$queryRaw<Array<{ lastNumber: number }>>`
    SELECT "lastNumber" FROM "InvoiceCounter" WHERE "fy" = ${counterKey} FOR UPDATE
  `;
  const nextSeq = (counterRows[0]?.lastNumber ?? 0) + 1;
  await tx.$executeRaw`
    UPDATE "InvoiceCounter"
    SET "lastNumber" = ${nextSeq}, "updatedAt" = NOW()
    WHERE "fy" = ${counterKey}
  `;

  const siteSettings = await tx.siteSettings.findUnique({
    where: { id: "default" },
  });
  const prefix = siteSettings?.invoicePrefix || "HB";
  const cnNumber = formatCreditNoteNumber(prefix, fy, nextSeq);

  return tx.creditNote.create({
    data: {
      invoiceId: invoice.id,
      orderId: invoice.orderId,
      fy,
      number: cnNumber,
      sequence: nextSeq,
      reason: params.reason,
      refundRef: params.refundRef,
      totalPaise: computed.totalPaise,
      taxablePaise: computed.taxablePaise,
      cgstPaise: computed.cgstPaise,
      sgstPaise: computed.sgstPaise,
      igstPaise: computed.igstPaise,
      lines: {
        create: computed.lines.map((l) => ({
          invoiceLineId: l.invoiceLineId,
          kind: l.kind,
          description: l.description,
          qty: l.qty,
          ratePercent: l.ratePercent,
          taxablePaise: l.taxablePaise,
          cgstPaise: l.cgstPaise,
          sgstPaise: l.sgstPaise,
          igstPaise: l.igstPaise,
          totalPaise: l.totalPaise,
        })),
      },
    },
    include: { lines: true },
  });
}
