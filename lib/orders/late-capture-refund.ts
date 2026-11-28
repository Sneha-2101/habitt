export const LATE_CAPTURE_REFUND_OUTBOX_TYPE = "LATE_CAPTURE_REFUND";

export function buildLateCaptureRefundDedupeKey(orderId: string, paymentId: string): string {
  return `late-capture-refund:${orderId}:${paymentId}`;
}

export function buildLateCaptureRefundIdempotencyKey(orderId: string, paymentId: string): string {
  return `late-capture-refund-${orderId}-${paymentId}`;
}

export function buildLateCaptureRefundOutboxPayload(input: {
  orderId: string;
  paymentId: string;
  amountPaise: number;
}): { orderId: string; paymentId: string; amountPaise: number } {
  return {
    orderId: input.orderId,
    paymentId: input.paymentId,
    amountPaise: input.amountPaise,
  };
}
