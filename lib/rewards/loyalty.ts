export interface ComputeLoyaltyEarnInput {
  goodsNetPaise: number;
  refundedGoodsPaise: number;
  storeCreditApplied: number;
  bps: number;
}

export interface ComputeLoyaltyEarnResult {
  basePaise: number;
  earnedPaise: number;
}

/**
 * Pure loyalty earn calculation (FLAT_PERCENT, integer paise).
 * base = max(0, goodsNetPaise - refundedGoodsPaise - min(storeCreditApplied, goodsNetPaise))
 * earned = floor(base * bps / 10000)
 */
export function computeLoyaltyEarn(
  input: ComputeLoyaltyEarnInput
): ComputeLoyaltyEarnResult {
  const goodsNet = Math.max(0, Math.trunc(input.goodsNetPaise));
  const refunded = Math.max(0, Math.trunc(input.refundedGoodsPaise));
  const credit = Math.max(0, Math.trunc(input.storeCreditApplied));
  const bps = Math.max(0, Math.trunc(input.bps));

  const walletShare = Math.min(credit, goodsNet);
  const basePaise = Math.max(0, goodsNet - refunded - walletShare);
  const earnedPaise = Math.floor((basePaise * bps) / 10000);

  return { basePaise, earnedPaise };
}
