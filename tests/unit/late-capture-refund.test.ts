import { describe, it, expect } from "vitest";
import {
  LATE_CAPTURE_REFUND_OUTBOX_TYPE,
  buildLateCaptureRefundDedupeKey,
  buildLateCaptureRefundIdempotencyKey,
  buildLateCaptureRefundOutboxPayload,
} from "@/lib/orders/late-capture-refund";

describe("orders/late-capture-refund helpers", () => {
  it("builds stable dedupeKey, idempotencyKey, and payload", () => {
    expect(LATE_CAPTURE_REFUND_OUTBOX_TYPE).toBe("LATE_CAPTURE_REFUND");
    expect(buildLateCaptureRefundDedupeKey("ord_1", "pay_1")).toBe(
      "late-capture-refund:ord_1:pay_1"
    );
    expect(buildLateCaptureRefundIdempotencyKey("ord_1", "pay_1")).toBe(
      "late-capture-refund-ord_1-pay_1"
    );
    expect(
      buildLateCaptureRefundOutboxPayload({
        orderId: "ord_1",
        paymentId: "pay_1",
        amountPaise: 50000,
      })
    ).toEqual({
      orderId: "ord_1",
      paymentId: "pay_1",
      amountPaise: 50000,
    });
  });
});
