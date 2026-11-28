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

describe("direct_t126_refund_retry_lookup", () => {
  const userId = "m1test_t126_user";
  const order1Id = "m1test_t126_ord_1";
  const order2Id = "m1test_t126_ord_2";
  const order3Id = "m1test_t126_ord_3";
  const ref1Id = "m1test_t126_ref_1";
  const ref2Id = "m1test_t126_ref_2";
  const ref3Id = "m1test_t126_ref_3";

  beforeAll(async () => {
    await cleanupM1TestRows();

    await prisma.user.create({
      data: {
        id: userId,
        email: "m1test_t126@example.com",
        name: "M1Test T126",
      },
    });

    await prisma.order.createMany({
      data: [
        {
          id: order1Id,
          displayId: "m1test_T126_1",
          userId,
          customerName: "M1Test T126",
          customerEmail: "m1test_t126@example.com",
          customerPhone: "9999999126",
          shippingAddress: { line1: "1 Test St", city: "Mumbai", state: "MH", pincode: "400001" },
          subtotal: 50000,
          total: 50000,
          paymentMethod: "RAZORPAY",
          paymentStatus: "PAID",
          fulfilmentStatus: "CANCELLED",
          razorpayPaymentId: "pay_m1test_t126_1",
        },
        {
          id: order2Id,
          displayId: "m1test_T126_2",
          userId,
          customerName: "M1Test T126",
          customerEmail: "m1test_t126@example.com",
          customerPhone: "9999999126",
          shippingAddress: { line1: "1 Test St", city: "Mumbai", state: "MH", pincode: "400001" },
          subtotal: 50000,
          total: 50000,
          paymentMethod: "RAZORPAY",
          paymentStatus: "PAID",
          fulfilmentStatus: "CANCELLED",
          razorpayPaymentId: "pay_m1test_t126_2",
        },
        {
          id: order3Id,
          displayId: "m1test_T126_3",
          userId,
          customerName: "M1Test T126",
          customerEmail: "m1test_t126@example.com",
          customerPhone: "9999999126",
          shippingAddress: { line1: "1 Test St", city: "Mumbai", state: "MH", pincode: "400001" },
          subtotal: 50000,
          total: 50000,
          paymentMethod: "RAZORPAY",
          paymentStatus: "PAID",
          fulfilmentStatus: "CANCELLED",
          razorpayPaymentId: "pay_m1test_t126_3",
        },
      ],
    });

    await prisma.refund.createMany({
      data: [
        {
          id: ref1Id,
          orderId: order1Id,
          method: "RAZORPAY",
          status: "FAILED",
          amountPaise: 50000,
          idempotencyKey: "m1test_t126_idem_1",
          failureReason: INTERRUPTED_REFUND_FAILURE_REASON,
        },
        {
          id: ref2Id,
          orderId: order2Id,
          method: "RAZORPAY",
          status: "FAILED",
          amountPaise: 50000,
          idempotencyKey: "m1test_t126_idem_2",
          failureReason: INTERRUPTED_REFUND_FAILURE_REASON,
        },
        {
          id: ref3Id,
          orderId: order3Id,
          method: "RAZORPAY",
          status: "FAILED",
          amountPaise: 50000,
          idempotencyKey: "m1test_t126_idem_3",
          failureReason: INTERRUPTED_REFUND_FAILURE_REASON,
        },
      ],
    });
  });

  afterAll(async () => {
    await cleanupM1TestRows();
  });

  it("completes existing gateway refund without re-refunding, issues once when absent, and fails closed on lookup error", async () => {
    // 1. Existing gateway refund -> 0 new refund calls
    mockFetchMultipleRefund.mockResolvedValueOnce({
      items: [{ id: "rfnd_m1test_t126_1", status: "processed", notes: { refundId: ref1Id } }],
    });
    const res1 = await issueRefund({
      orderId: order1Id,
      method: "RAZORPAY",
      amountPaise: 50000,
      idempotencyKey: "m1test_t126_idem_1",
    });
    expect(res1.success).toBe(true);
    expect(res1.refund.status).toBe("PROCESSED");
    expect(mockRefundCreate).toHaveBeenCalledTimes(0);

    // 2. Nothing at gateway -> issues exactly 1 refund
    mockFetchMultipleRefund.mockResolvedValueOnce({ items: [] });
    mockRefundCreate.mockResolvedValueOnce({ id: "rfnd_m1test_t126_2" });
    const res2 = await issueRefund({
      orderId: order2Id,
      method: "RAZORPAY",
      amountPaise: 50000,
      idempotencyKey: "m1test_t126_idem_2",
    });
    expect(res2.success).toBe(true);
    expect(res2.refund.status).toBe("PROCESSED");
    expect(mockRefundCreate).toHaveBeenCalledTimes(1);

    // 3. Lookup error -> fails closed with 0 new refund calls
    mockFetchMultipleRefund.mockRejectedValueOnce(new Error("Gateway unavailable"));
    const res3 = await issueRefund({
      orderId: order3Id,
      method: "RAZORPAY",
      amountPaise: 50000,
      idempotencyKey: "m1test_t126_idem_3",
    });
    expect(res3.success).toBe(false);
    expect(res3.refund.status).toBe("FAILED");
    expect(mockRefundCreate).toHaveBeenCalledTimes(1);
  });
});
