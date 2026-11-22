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

  const alreadyCreditedTotal = invoice.creditNotes.reduce(
    (sum, cn) => sum + cn.totalPaise,
    0
  );
  const remainingCreditable = Math.max(0, invoice.totalPaise - alreadyCreditedTotal);
  if (remainingCreditable <= 0) {
    return null;
  }

  type LineDraft = {
    invoiceLineId: string;
    kind: InvoiceLineKind;
    description: string;
    qty: number;
    ratePercent: Prisma.Decimal;
    taxablePaise: number;
    cgstPaise: number;
    sgstPaise: number;
    igstPaise: number;
    totalPaise: number;
  };

  const draftLines: LineDraft[] = [];

  // Track already credited amount and quantity per invoice line
  const creditedPerLine = new Map<string, number>();
  const creditedQtyPerLine = new Map<string, number>();
  for (const cn of invoice.creditNotes) {
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

  if (params.refundedItems && params.refundedItems.length > 0) {
    const goodsLines = invoice.lines.filter((l) => l.kind === "GOODS");
    const isFullGoodsRefund =
      goodsLines.length > 0 &&
      goodsLines.every((gLine) => {
        const item = params.refundedItems?.find((i) => i.orderItemId === gLine.orderItemId);
        const alreadyQty = creditedQtyPerLine.get(gLine.id) || 0;
        return (alreadyQty + (item?.qty || 0)) >= gLine.qty;
      });

    for (const refItem of params.refundedItems) {
      const line = invoice.lines.find(
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

      const ratio = Math.min(1, effectiveQty / line.qty);
      let lineTotal = Math.round(line.netPaise * ratio);
      lineTotal = Math.min(lineTotal, remainingLine);
      if (lineTotal <= 0) continue;

      const rate = Number(line.ratePercent);
      const tax = extractInclusiveTax(lineTotal, rate);
      const split = splitTax(tax.taxPaise, invoice.isInterState);

      draftLines.push({
        invoiceLineId: line.id,
        kind: line.kind,
        description: `Credit: ${line.description}`,
        qty: effectiveQty,
        ratePercent: line.ratePercent,
        taxablePaise: tax.taxablePaise,
        cgstPaise: split.cgstPaise,
        sgstPaise: split.sgstPaise,
        igstPaise: split.igstPaise,
        totalPaise: lineTotal,
      });

      creditedPerLine.set(line.id, alreadyLine + lineTotal);
      creditedQtyPerLine.set(line.id, alreadyQty + effectiveQty);
    }

    if (params.includeFeeShare || isFullGoodsRefund) {
      const feeLines = invoice.lines.filter((l) => l.kind !== "GOODS");
      const goodsInvoiceNet = goodsLines.reduce((sum, l) => sum + l.netPaise, 0);
      const goodsRefundedNet = draftLines.reduce((sum, l) => sum + l.totalPaise, 0);
      const feeRatio = isFullGoodsRefund
        ? 1
        : goodsInvoiceNet > 0
        ? goodsRefundedNet / goodsInvoiceNet
        : 1;

      for (const feeLine of feeLines) {
        if (feeLine.kind === "SHIPPING" && params.refundShippingFee === false) continue;
        if (feeLine.kind === "COD" && params.refundCodFee === false) continue;

        const alreadyFee = creditedPerLine.get(feeLine.id) || 0;
        const remainingFee = Math.max(0, feeLine.netPaise - alreadyFee);
        if (remainingFee <= 0) continue;

        let feeTotal = Math.round(feeLine.netPaise * feeRatio);
        feeTotal = Math.min(feeTotal, remainingFee);
        if (feeTotal <= 0) continue;

        const rate = Number(feeLine.ratePercent);
        const tax = extractInclusiveTax(feeTotal, rate);
        const split = splitTax(tax.taxPaise, invoice.isInterState);

        draftLines.push({
          invoiceLineId: feeLine.id,
          kind: feeLine.kind,
          description: `Credit: ${feeLine.description}`,
          qty: 1,
          ratePercent: feeLine.ratePercent,
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
    const targetAmount = params.refundAmountPaise
      ? Math.min(params.refundAmountPaise, remainingCreditable)
      : remainingCreditable;

    const currentCreditableTotal = invoice.lines.reduce((sum, line) => {
      const already = creditedPerLine.get(line.id) || 0;
      return sum + Math.max(0, line.netPaise - already);
    }, 0);

    if (currentCreditableTotal <= 0) return null;

    const scale = Math.min(1, targetAmount / currentCreditableTotal);

    for (const line of invoice.lines) {
      const already = creditedPerLine.get(line.id) || 0;
      const remainingLine = Math.max(0, line.netPaise - already);
      if (remainingLine <= 0) continue;

      let lineTotal = Math.round(remainingLine * scale);
      lineTotal = Math.min(lineTotal, remainingLine);
      if (lineTotal <= 0) continue;

      const rate = Number(line.ratePercent);
      const tax = extractInclusiveTax(lineTotal, rate);
      const split = splitTax(tax.taxPaise, invoice.isInterState);

      draftLines.push({
        invoiceLineId: line.id,
        kind: line.kind,
        description: `Credit: ${line.description}`,
        qty: line.qty,
        ratePercent: line.ratePercent,
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
      const split = splitTax(tax.taxPaise, invoice.isInterState);
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

  const totalPaise = draftLines.reduce((s, l) => s + l.totalPaise, 0);
  const taxablePaise = draftLines.reduce((s, l) => s + l.taxablePaise, 0);
  const cgstPaise = draftLines.reduce((s, l) => s + l.cgstPaise, 0);
  const sgstPaise = draftLines.reduce((s, l) => s + l.sgstPaise, 0);
  const igstPaise = draftLines.reduce((s, l) => s + l.igstPaise, 0);

  return tx.creditNote.create({
    data: {
      invoiceId: invoice.id,
      orderId: invoice.orderId,
      fy,
      number: cnNumber,
      sequence: nextSeq,
      reason: params.reason,
      refundRef: params.refundRef,
      totalPaise,
      taxablePaise,
      cgstPaise,
      sgstPaise,
      igstPaise,
      lines: {
        create: draftLines.map((l) => ({
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
