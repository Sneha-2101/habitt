import { describe, it, expect } from "vitest";
import {
  STALE_REFUND_THRESHOLD_MS,
  isRefundStale,
  findMatchingGatewayRefund,
  computeRefundPaymentStatus,
} from "@/lib/refunds/recover-refunds";

describe("refunds/recover-refunds helpers", () => {
  it("uses a 15-minute stale threshold", () => {
    expect(STALE_REFUND_THRESHOLD_MS).toBe(15 * 60 * 1000);
  });

  it("detects stale PENDING refunds accurately", () => {
    const now = new Date("2026-11-28T12:00:00.000Z");
    const sixteenMinAgo = new Date(now.getTime() - 16 * 60 * 1000);
    const tenMinAgo = new Date(now.getTime() - 10 * 60 * 1000);

    expect(isRefundStale({ status: "PENDING", initiatedAt: sixteenMinAgo }, now)).toBe(true);
    expect(isRefundStale({ status: "PENDING", initiatedAt: tenMinAgo }, now)).toBe(false);
    expect(isRefundStale({ status: "PROCESSED", initiatedAt: sixteenMinAgo }, now)).toBe(false);
    expect(isRefundStale({ status: "FAILED", initiatedAt: sixteenMinAgo }, now)).toBe(false);
  });

  it("matches gateway refund by notes.refundId or receipt", () => {
    const items = [
      { id: "rfnd_1", status: "processed", notes: { refundId: "ref_a" } },
      { id: "rfnd_2", status: "failed", receipt: "ref_b" },
    ];

    expect(findMatchingGatewayRefund(items, "ref_a")?.id).toBe("rfnd_1");
    expect(findMatchingGatewayRefund(items, "ref_b")?.id).toBe("rfnd_2");
    expect(findMatchingGatewayRefund(items, "ref_missing")).toBeNull();
  });

  it("computes REFUNDED vs PARTIALLY_REFUNDED payment status", () => {
    expect(computeRefundPaymentStatus(10000, 10000)).toBe("REFUNDED");
    expect(computeRefundPaymentStatus(12000, 10000)).toBe("REFUNDED");
    expect(computeRefundPaymentStatus(5000, 10000)).toBe("PARTIALLY_REFUNDED");
  });
});
