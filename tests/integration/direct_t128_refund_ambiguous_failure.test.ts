import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { cleanupM1TestRows } from "../helpers/fixtures";
import { INTERRUPTED_REFUND_FAILURE_REASON } from "@/lib/refunds/recover-refunds";

const mockRefundCreate = vi.fn();
const mockFetchMultipleRefund = vi.fn();
const mockFetchRefund = vi.fn();

vi.mock("@/lib/razorpay", () => ({
  getRazorpay: () => ({
    payments: {
      refund: mockRefundCreate,
      fetchMultipleRefund: mockFetchMultipleRefund,
      fetchRefund: mockFetchRefund,
    },
  }),
}));

import { issueRefund } from "@/lib/refunds/issue-refund";

describe("direct_t128_refund_ambiguous_failure", () => {
  const userId = "m1test_t128_user";
  const ordA = "m1test_t128_ord_a";
  const ordB = "m1test_t128_ord_b";
  const ordC = "m1test_t128_ord_c";
  const ordD = "m1test_t128_ord_d";

  beforeAll(async () => {
    await cleanupM1TestRows();

    await prisma.user.create({
      data: {
        id: userId,
        email: "m1test_t128@example.com",
        name: "M1Test T128",
      },
    });

    await prisma.order.createMany({
      data: [ordA, ordB, ordC, ordD].map((id, idx) => ({
        id,
        displayId: `m1test_T128_${idx + 1}`,
        userId,
        customerName: "M1Test T128",
        customerEmail: "m1test_t128@example.com",
        customerPhone: "9999999128",
        shippingAddress: { line1: "1 Test St", city: "Mumbai", state: "MH", pincode: "400001" },
        subtotal: 50000,
        total: 50000,
        paymentMethod: "RAZORPAY",
        paymentStatus: "PAID",
        fulfilmentStatus: "CANCELLED",
        razorpayPaymentId: `pay_m1test_t128_${idx + 1}`,
      })),
    });
  });

  afterAll(async () => {
    await cleanupM1TestRows();
  });

  it("(a) ambiguous timeout marks interrupted failureReason and retry completes without re-refunding when gateway refund exists", async () => {
    mockRefundCreate.mockRejectedValueOnce(new Error("ETIMEDOUT"));
    const first = await issueRefund({
      orderId: ordA,
      method: "RAZORPAY",
      amountPaise: 50000,
      idempotencyKey: "m1test_t128_idem_a",
    });
    expect(first.success).toBe(false);
    expect(first.refund.status).toBe("FAILED");
    expect(first.refund.failureReason?.startsWith(INTERRUPTED_REFUND_FAILURE_REASON)).toBe(true);

    mockFetchMultipleRefund.mockResolvedValueOnce({
      items: [{ id: "rfnd_m1test_t128_a", status: "processed", notes: { refundId: first.refund.id } }],
    });
    const retry = await issueRefund({
      orderId: ordA,
      method: "RAZORPAY",
      amountPaise: 50000,
      idempotencyKey: "m1test_t128_idem_a",
    });
    expect(retry.success).toBe(true);
    expect(retry.refund.status).toBe("PROCESSED");
    expect(mockRefundCreate).toHaveBeenCalledTimes(1);
  });

  it("(b) ambiguous timeout then retry with empty gateway list issues exactly one new refund", async () => {
    mockRefundCreate.mockClear();
    mockRefundCreate.mockRejectedValueOnce(new Error("socket hang up"));
    const first = await issueRefund({
      orderId: ordB,
      method: "RAZORPAY",
      amountPaise: 50000,
      idempotencyKey: "m1test_t128_idem_b",
    });
    expect(first.success).toBe(false);

    mockFetchMultipleRefund.mockResolvedValueOnce({ items: [] });
    mockRefundCreate.mockResolvedValueOnce({ id: "rfnd_m1test_t128_b" });
    const retry = await issueRefund({
      orderId: ordB,
      method: "RAZORPAY",
      amountPaise: 50000,
      idempotencyKey: "m1test_t128_idem_b",
    });
    expect(retry.success).toBe(true);
    expect(retry.refund.status).toBe("PROCESSED");
    expect(mockRefundCreate).toHaveBeenCalledTimes(2);
  });

  it("(c) ambiguous timeout then retry where lookup throws issues zero new refunds and stays FAILED", async () => {
    mockRefundCreate.mockClear();
    mockRefundCreate.mockRejectedValueOnce({ statusCode: 503, error: { description: "Service unavailable" } });
    const first = await issueRefund({
      orderId: ordC,
      method: "RAZORPAY",
      amountPaise: 50000,
      idempotencyKey: "m1test_t128_idem_c",
    });
    expect(first.success).toBe(false);
    expect(first.refund.failureReason?.startsWith(INTERRUPTED_REFUND_FAILURE_REASON)).toBe(true);

    mockFetchMultipleRefund.mockRejectedValueOnce(new Error("Gateway lookup 503"));
    const retry = await issueRefund({
      orderId: ordC,
      method: "RAZORPAY",
      amountPaise: 50000,
      idempotencyKey: "m1test_t128_idem_c",
    });
    expect(retry.success).toBe(false);
    expect(retry.refund.status).toBe("FAILED");
    expect(mockRefundCreate).toHaveBeenCalledTimes(1);
  });

  it("(d) definite 4xx rejection stores plain error as failureReason and retry calls gateway without lookup", async () => {
    mockRefundCreate.mockClear();
    mockFetchMultipleRefund.mockClear();
    mockRefundCreate.mockRejectedValueOnce({
      statusCode: 400,
      error: { description: "Refund amount exceeds captured amount" },
    });
    const first = await issueRefund({
      orderId: ordD,
      method: "RAZORPAY",
      amountPaise: 50000,
      idempotencyKey: "m1test_t128_idem_d",
    });
    expect(first.success).toBe(false);
    expect(first.refund.failureReason).toBe("Refund amount exceeds captured amount");

    mockRefundCreate.mockResolvedValueOnce({ id: "rfnd_m1test_t128_d" });
    const retry = await issueRefund({
      orderId: ordD,
      method: "RAZORPAY",
      amountPaise: 50000,
      idempotencyKey: "m1test_t128_idem_d",
    });
    expect(retry.success).toBe(true);
    expect(mockFetchMultipleRefund).not.toHaveBeenCalled();
    expect(mockRefundCreate).toHaveBeenCalledTimes(2);
  });
});
