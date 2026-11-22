import { isSameState, normalizeState } from "./states";

export interface GstRuleInput {
  id?: string;
  name?: string;
  hsn?: string | null;
  categoryId?: string | null;
  minUnitPaise?: number; // default 0
  maxUnitPaise?: number | null;
  ratePercent: number; // e.g. 5, 12, 18, 28
  active?: boolean;
}

export interface InvoiceLineItemInput {
  orderItemId?: string | null;
  description: string;
  hsn?: string | null;
  categoryId?: string | null;
  qty: number;
  unitPricePaise: number; // inclusive unit price
  discountPaise: number; // total discount allocated to this line
  isGift?: boolean;
}

export interface ComputedInvoiceLine {
  orderItemId?: string | null;
  kind?: "GOODS" | "SHIPPING" | "COD";
  description: string;
  hsn: string | null;
  qty: number;
  unitPaise: number;
  discountPaise: number;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  ratePercent: number;
  totalPaise: number;
  isGift: boolean;
}

export interface ComputeInvoiceInput {
  items: InvoiceLineItemInput[];
  shippingFeePaise: number;
  codFeePaise: number;
  feeMode: "COMPOSITE" | "SEPARATE";
  feeRatePercent?: number; // default 18
  fallbackGstRatePercent?: number; // from SiteSettings.gstRate e.g. 18
  rules?: GstRuleInput[];
  buyerState?: string | null;
  businessState?: string | null;
}

export interface ComputedInvoiceTotals {
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  totalPaise: number;
}

export interface ComputeInvoiceResult {
  lines: ComputedInvoiceLine[];
  totals: ComputedInvoiceTotals;
  placeOfSupply: string;
  isInterState: boolean;
  warnings: string[];
}

/**
 * Extracts inclusive tax from a gross amount.
 * taxable = round(amount * 100 / (100 + rate))
 * tax = amount - taxable
 */
export function extractInclusiveTax(
  amountPaise: number,
  ratePercent: number
): { taxablePaise: number; taxPaise: number } {
  if (amountPaise <= 0 || ratePercent <= 0) {
    return { taxablePaise: Math.max(0, amountPaise), taxPaise: 0 };
  }
  const taxablePaise = Math.round((amountPaise * 100) / (100 + ratePercent));
  const taxPaise = amountPaise - taxablePaise;
  return { taxablePaise, taxPaise };
}

/**
 * Splits tax into CGST/SGST or IGST based on intra-state vs inter-state supply.
 * Intra-state: CGST + SGST (half each, odd paise to CGST).
 * Inter-state: IGST.
 */
export function splitTax(
  taxPaise: number,
  isInterState: boolean
): { cgstPaise: number; sgstPaise: number; igstPaise: number } {
  if (taxPaise <= 0) {
    return { cgstPaise: 0, sgstPaise: 0, igstPaise: 0 };
  }
  if (isInterState) {
    return { cgstPaise: 0, sgstPaise: 0, igstPaise: taxPaise };
  }
  const cgstPaise = Math.ceil(taxPaise / 2);
  const sgstPaise = taxPaise - cgstPaise;
  return { cgstPaise, sgstPaise, igstPaise: 0 };
}

/**
 * Deterministic Largest Remainder distribution of an integer total across weights.
 * Invariant: sum(results) === total.
 */
export function allocateLargestRemainder(total: number, weights: number[]): number[] {
  if (weights.length === 0) return [];
  if (total <= 0) return weights.map(() => 0);

  const sumWeights = weights.reduce((sum, w) => sum + Math.max(0, w), 0);
  if (sumWeights === 0) {
    // Equal distribution if all weights are zero
    const base = Math.floor(total / weights.length);
    let remainder = total - base * weights.length;
    return weights.map(() => {
      const add = remainder > 0 ? 1 : 0;
      if (remainder > 0) remainder--;
      return base + add;
    });
  }

  const exactAllocations = weights.map((w) => (Math.max(0, w) * total) / sumWeights);
  const floored = exactAllocations.map(Math.floor);
  const remainder = total - floored.reduce((sum, v) => sum + v, 0);

  const indexedRemainders = exactAllocations.map((exact, idx) => ({
    idx,
    fraction: exact - floored[idx],
  }));

  // Sort descending by fractional remainder, with stable index tie-breaking
  indexedRemainders.sort((a, b) => b.fraction - a.fraction || a.idx - b.idx);

  const result = [...floored];
  for (let i = 0; i < remainder; i++) {
    result[indexedRemainders[i].idx] += 1;
  }

  return result;
}

/**
 * Resolves the applicable GST rate and HSN for a given order item.
 * Evaluates active rules matching category, HSN, and unit net price.
 */
export function matchGstRule(
  item: InvoiceLineItemInput,
  rules: GstRuleInput[] = [],
  fallbackRate: number = 0
): { ratePercent: number; hsn: string | null; warning?: string } {
  const activeRules = rules.filter((r) => r.active !== false);
  const qty = Math.max(1, item.qty);
  const netLineTotal = Math.max(0, item.unitPricePaise * qty - item.discountPaise);
  const netUnitPrice = Math.round(netLineTotal / qty);

  // Match rule by category, HSN, and price tier
  for (const r of activeRules) {
    if (r.categoryId && item.categoryId && r.categoryId !== item.categoryId) {
      continue;
    }
    if (r.hsn && item.hsn && r.hsn !== item.hsn) {
      continue;
    }
    const min = r.minUnitPaise ?? 0;
    if (netUnitPrice < min) continue;
    if (r.maxUnitPaise !== null && r.maxUnitPaise !== undefined && netUnitPrice > r.maxUnitPaise) {
      continue;
    }

    return {
      ratePercent: Number(r.ratePercent),
      hsn: r.hsn || item.hsn || null,
    };
  }

  // Fallback if no specific rule matched
  const warn = activeRules.length > 0 ? `No matching GST rule found for "${item.description}"; applied fallback rate ${fallbackRate}%` : undefined;
  return {
    ratePercent: fallbackRate,
    hsn: item.hsn || null,
    warning: warn,
  };
}

/**
 * Computes all invoice lines and totals according to CA business rules.
 */
export function computeInvoiceLines(input: ComputeInvoiceInput): ComputeInvoiceResult {
  const {
    items,
    shippingFeePaise = 0,
    codFeePaise = 0,
    feeMode = "COMPOSITE",
    feeRatePercent = 18,
    fallbackGstRatePercent = 0,
    rules = [],
    buyerState,
    businessState,
  } = input;

  const warnings: string[] = [];

  // 1. Determine Place of Supply and Inter-State vs Intra-State
  const normBuyer = normalizeState(buyerState);
  const normSeller = normalizeState(businessState);

  let isInterState = false;
  const placeOfSupply = normBuyer?.name || (buyerState?.trim() || "Unknown");

  if (!normBuyer) {
    isInterState = true;
    warnings.push(`Buyer state "${buyerState || ""}" could not be recognized; defaulted to IGST.`);
  } else if (!normSeller) {
    isInterState = true;
    warnings.push(`Seller business state "${businessState || ""}" is not configured; defaulted to IGST.`);
  } else {
    isInterState = !isSameState(normBuyer.code, normSeller.code);
  }

  // 2. Identify goods lines and their net values
  const lines: ComputedInvoiceLine[] = [];

  // Compute pre-fee net total per item
  const itemNetTotals = items.map((item) => {
    if (item.isGift) return 0;
    const gross = item.unitPricePaise * item.qty;
    return Math.max(0, gross - item.discountPaise);
  });

  const totalFeePaise = Math.max(0, shippingFeePaise) + Math.max(0, codFeePaise);
  const hasEligibleGoods = itemNetTotals.some((val) => val > 0);

  // If COMPOSITE mode and eligible goods lines exist, allocate fees to goods lines
  let allocatedFees: number[] = items.map(() => 0);
  let feesHandledCompositely = false;

  if (feeMode === "COMPOSITE" && totalFeePaise > 0 && hasEligibleGoods) {
    allocatedFees = allocateLargestRemainder(totalFeePaise, itemNetTotals);
    feesHandledCompositely = true;
  }

  // 3. Process goods lines
  items.forEach((item, idx) => {
    if (item.isGift) {
      lines.push({
        orderItemId: item.orderItemId ?? null,
        kind: "GOODS",
        description: `${item.description} (Free Gift)`,
        hsn: item.hsn || null,
        qty: item.qty,
        unitPaise: 0,
        discountPaise: 0,
        taxablePaise: 0,
        cgstPaise: 0,
        sgstPaise: 0,
        igstPaise: 0,
        ratePercent: 0,
        totalPaise: 0,
        isGift: true,
      });
      return;
    }

    const { ratePercent, hsn, warning } = matchGstRule(item, rules, fallbackGstRatePercent);
    if (warning) warnings.push(warning);

    const netPaise = itemNetTotals[idx];
    const finalLineTotal = netPaise + allocatedFees[idx];

    const { taxablePaise, taxPaise } = extractInclusiveTax(finalLineTotal, ratePercent);
    const { cgstPaise, sgstPaise, igstPaise } = splitTax(taxPaise, isInterState);

    lines.push({
      orderItemId: item.orderItemId ?? null,
      kind: "GOODS",
      description: item.description,
      hsn,
      qty: item.qty,
      unitPaise: item.unitPricePaise,
      discountPaise: item.discountPaise,
      taxablePaise,
      cgstPaise,
      sgstPaise,
      igstPaise,
      ratePercent,
      totalPaise: finalLineTotal,
      isGift: false,
    });
  });

  // 4. If SEPARATE mode (or fallback when no eligible goods for COMPOSITE), add fee lines
  if (!feesHandledCompositely) {
    if (shippingFeePaise > 0) {
      const { taxablePaise, taxPaise } = extractInclusiveTax(shippingFeePaise, feeRatePercent);
      const { cgstPaise, sgstPaise, igstPaise } = splitTax(taxPaise, isInterState);
      lines.push({
        orderItemId: null,
        kind: "SHIPPING",
        description: "Shipping & Delivery Charges",
        hsn: "996812", // Postal & courier courier services HSN
        qty: 1,
        unitPaise: shippingFeePaise,
        discountPaise: 0,
        taxablePaise,
        cgstPaise,
        sgstPaise,
        igstPaise,
        ratePercent: feeRatePercent,
        totalPaise: shippingFeePaise,
        isGift: false,
      });
    }

    if (codFeePaise > 0) {
      const { taxablePaise, taxPaise } = extractInclusiveTax(codFeePaise, feeRatePercent);
      const { cgstPaise, sgstPaise, igstPaise } = splitTax(taxPaise, isInterState);
      lines.push({
        orderItemId: null,
        kind: "COD",
        description: "Cash on Delivery Handling Charges",
        hsn: "997159", // Financial services HSN
        qty: 1,
        unitPaise: codFeePaise,
        discountPaise: 0,
        taxablePaise,
        cgstPaise,
        sgstPaise,
        igstPaise,
        ratePercent: feeRatePercent,
        totalPaise: codFeePaise,
        isGift: false,
      });
    }
  }

  // 5. Aggregate totals
  const totals: ComputedInvoiceTotals = lines.reduce(
    (acc, l) => ({
      taxablePaise: acc.taxablePaise + l.taxablePaise,
      cgstPaise: acc.cgstPaise + l.cgstPaise,
      sgstPaise: acc.sgstPaise + l.sgstPaise,
      igstPaise: acc.igstPaise + l.igstPaise,
      totalPaise: acc.totalPaise + l.totalPaise,
    }),
    { taxablePaise: 0, cgstPaise: 0, sgstPaise: 0, igstPaise: 0, totalPaise: 0 }
  );

  return {
    lines,
    totals,
    placeOfSupply,
    isInterState,
    warnings,
  };
}
