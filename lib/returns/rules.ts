export interface ReturnableOrderItem {
  id: string;
  unitPrice: number; // in paise
  qty: number;
  discountPaise?: number;
  isGift?: boolean;
}

export interface ComputeRefundInput {
  orderItems: ReturnableOrderItem[];
  /** Mapping of orderItemId -> qty being returned in this request */
  returningQtys: Record<string, number>;
  /** Mapping of orderItemId -> qty already returned/approved in prior returns */
  existingReturnedQtys?: Record<string, number>;
  /** Mapping of orderItemId -> amount in paise already refunded in prior returns */
  existingRefundedPaise?: Record<string, number>;
  /** Fees on the order */
  shippingFeePaise?: number;
  codFeePaise?: number;
  /** Whether fees have already been refunded */
  feesAlreadyRefunded?: boolean;
  /** Total amount actually paid by customer for the order (including store credit used) */
  totalPaidPaise?: number;
  /** Cumulative amount already refunded across all prior refunds for this order */
  cumulativeRefundedPaise?: number;
}

export interface ComputeRefundResult {
  /** Map of orderItemId -> refund amount in paise */
  itemRefunds: Record<string, number>;
  itemsSubtotalPaise: number;
  shippingFeeRefundPaise: number;
  codFeeRefundPaise: number;
  feesRefundPaise: number;
  totalRefundPaise: number;
  isCompleteReturn: boolean;
}

/**
 * Checks whether the return window is open for a delivered order.
 * Window is calculated in IST (UTC+5:30) calendar days from delivery date.
 * Within 'windowDays' (default 7 days):
 * Day 0 through Day 7 are open; Day 8 and beyond are expired.
 */
export function isReturnWindowOpen(
  deliveredAt: Date | string | null | undefined,
  now: Date | string = new Date(),
  windowDays: number = 7
): boolean {
  if (!deliveredAt) return false;
  const del = new Date(deliveredAt);
  const current = new Date(now);
  if (isNaN(del.getTime()) || isNaN(current.getTime())) return false;
  if (current.getTime() < del.getTime()) return false;

  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const delISTDay = Math.floor((del.getTime() + IST_OFFSET_MS) / (24 * 60 * 60 * 1000));
  const currentISTDay = Math.floor((current.getTime() + IST_OFFSET_MS) / (24 * 60 * 60 * 1000));
  const diffDays = currentISTDay - delISTDay;

  return diffDays <= windowDays;
}

/**
 * Calculates remaining returnable quantity for an order item.
 * Free gift lines (isGift) cannot be returned (returns 0).
 * Cumulative returned qty can never exceed ordered qty.
 */
export function remainingReturnableQty(
  orderItem: { qty: number; isGift?: boolean },
  existingReturnedQty: number = 0
): number {
  if (orderItem.isGift) return 0;
  return Math.max(0, orderItem.qty - Math.max(0, existingReturnedQty));
}

/**
 * Computes refund amounts per item and fees according to business rules:
 * - Refund amount per item = net paid value for returned qty:
 *   (unitPrice * qty - discountPaise) scaled by returnedQty / qty.
 * - Uses largest-remainder rounding across items so partial returns of the same line
 *   sum exactly to the line net when fully returned.
 * - Shipping and COD fees are refunded ONLY when the cumulative return covers
 *   every non-gift item of the order in full.
 * - Total refunded per order never exceeds the amount actually paid.
 */
export function computeRefund(input: ComputeRefundInput): ComputeRefundResult {
  const {
    orderItems,
    returningQtys,
    existingReturnedQtys = {},
    existingRefundedPaise = {},
    shippingFeePaise = 0,
    codFeePaise = 0,
    feesAlreadyRefunded = false,
    totalPaidPaise,
    cumulativeRefundedPaise = 0,
  } = input;

  // Filter non-gift items
  const nonGiftItems = orderItems.filter((i) => !i.isGift);

  // Check if every non-gift item will be completely returned with this return
  let isComplete = nonGiftItems.length > 0;
  for (const item of nonGiftItems) {
    const prev = existingReturnedQtys[item.id] || 0;
    const curr = returningQtys[item.id] || 0;
    if (prev + curr < item.qty) {
      isComplete = false;
      break;
    }
  }

  // Fees refunded only on complete return of all non-gift items and if not already refunded
  let shippingFeeRefundPaise = 0;
  let codFeeRefundPaise = 0;
  if (isComplete && !feesAlreadyRefunded) {
    shippingFeeRefundPaise = Math.max(0, shippingFeePaise);
    codFeeRefundPaise = Math.max(0, codFeePaise);
  }
  let feesRefundPaise = shippingFeeRefundPaise + codFeeRefundPaise;

  const itemRefunds: Record<string, number> = {};
  const activeItemsToReturn = nonGiftItems.filter((item) => (returningQtys[item.id] || 0) > 0);

  // Separate items into final vs non-final
  const nonFinalItems: Array<{
    item: ReturnableOrderItem;
    returningQty: number;
    idealFloat: number;
    floorVal: number;
    remainder: number;
    maxRemaining: number;
  }> = [];

  for (const item of activeItemsToReturn) {
    const q = returningQtys[item.id] || 0;
    const prevQty = existingReturnedQtys[item.id] || 0;
    const lineNet = Math.max(0, item.unitPrice * item.qty - (item.discountPaise || 0));
    const prevRefunded =
      existingRefundedPaise[item.id] !== undefined
        ? existingRefundedPaise[item.id]
        : Math.round((lineNet * prevQty) / item.qty);

    const maxRemaining = Math.max(0, lineNet - prevRefunded);
    const isFinalForLine = prevQty + q >= item.qty;

    if (isFinalForLine) {
      // Final return for this line receives exactly the remaining net line value
      itemRefunds[item.id] = maxRemaining;
    } else {
      // Pro-rata continuous share
      const idealFloat = (lineNet * q) / item.qty;
      const floorVal = Math.floor(idealFloat);
      const remainder = idealFloat - floorVal;
      nonFinalItems.push({
        item,
        returningQty: q,
        idealFloat,
        floorVal,
        remainder,
        maxRemaining,
      });
    }
  }

  // Distribute largest-remainder among non-final items
  if (nonFinalItems.length > 0) {
    const totalIdealNonFinal = nonFinalItems.reduce((acc, x) => acc + x.idealFloat, 0);
    const targetNonFinalTotal = Math.round(totalIdealNonFinal);
    const sumFloors = nonFinalItems.reduce((acc, x) => acc + x.floorVal, 0);
    let extraPaise = Math.max(0, targetNonFinalTotal - sumFloors);

    // Sort by remainder descending
    const sorted = [...nonFinalItems].sort((a, b) => b.remainder - a.remainder);
    for (const entry of sorted) {
      let allocated = entry.floorVal;
      if (extraPaise > 0) {
        allocated += 1;
        extraPaise -= 1;
      }
      itemRefunds[entry.item.id] = Math.min(entry.maxRemaining, Math.max(0, allocated));
    }
  }

  // Calculate items subtotal
  let itemsSubtotalPaise = 0;
  for (const item of activeItemsToReturn) {
    itemsSubtotalPaise += itemRefunds[item.id] || 0;
  }

  let totalRefundPaise = itemsSubtotalPaise + feesRefundPaise;

  // Cap at amount paid minus cumulative already refunded (if totalPaidPaise provided)
  if (totalPaidPaise !== undefined) {
    const maxAllowable = Math.max(0, totalPaidPaise - Math.max(0, cumulativeRefundedPaise));
    if (totalRefundPaise > maxAllowable) {
      const overage = totalRefundPaise - maxAllowable;
      // Trim fees first, then items
      if (feesRefundPaise >= overage) {
        if (codFeeRefundPaise >= overage) {
          codFeeRefundPaise -= overage;
        } else {
          const rem = overage - codFeeRefundPaise;
          codFeeRefundPaise = 0;
          shippingFeeRefundPaise = Math.max(0, shippingFeeRefundPaise - rem);
        }
        feesRefundPaise = shippingFeeRefundPaise + codFeeRefundPaise;
      } else {
        const itemOverage = overage - feesRefundPaise;
        shippingFeeRefundPaise = 0;
        codFeeRefundPaise = 0;
        feesRefundPaise = 0;

        let rem = itemOverage;
        for (const item of activeItemsToReturn) {
          const curr = itemRefunds[item.id] || 0;
          const deduction = Math.min(curr, rem);
          itemRefunds[item.id] = curr - deduction;
          rem -= deduction;
          if (rem <= 0) break;
        }
        itemsSubtotalPaise = activeItemsToReturn.reduce(
          (sum, item) => sum + (itemRefunds[item.id] || 0),
          0
        );
      }
      totalRefundPaise = maxAllowable;
    }
  }

  totalRefundPaise = Math.max(0, totalRefundPaise);

  return {
    itemRefunds,
    itemsSubtotalPaise,
    shippingFeeRefundPaise,
    codFeeRefundPaise,
    feesRefundPaise,
    totalRefundPaise,
    isCompleteReturn: isComplete,
  };
}
