export interface RefundEmailSplit {
  gatewayAmountPaise?: number;
  walletAmountPaise?: number;
}

/**
 * Format human-readable refund destination wording for return-refunded emails.
 */
export function formatReturnRefundMethodDescription(
  method: string,
  split?: RefundEmailSplit
): string {
  const gw = split?.gatewayAmountPaise ?? 0;
  const wl = split?.walletAmountPaise ?? 0;
  if (gw > 0 && wl > 0) {
    return `split: ₹${(gw / 100).toFixed(2)} initiated to your original payment method and ₹${(
      wl / 100
    ).toFixed(2)} credited to your Store Credit wallet`;
  }
  return method === "STORE_CREDIT"
    ? "credited to your Store Credit wallet"
    : "initiated to your original payment method";
}
