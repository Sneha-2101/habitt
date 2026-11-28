import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { cleanupM1TestRows } from "../helpers/fixtures";

const mockFetchMultipleRefund = vi.fn();
const mockFetchRefund = vi.fn();

vi.mock("@/lib/razorpay", () => ({
  getRazorpay: () => ({
    payments: {
      fetchMultipleRefund: mockFetchMultipleRefund,
      fetchRefund: mockFetchRefund,
    },
  }),
}));

import { recoverInterruptedRefunds } from "@/lib/refunds/recover-refunds";

describe("direct_t124_refund_recovery", () => {
  const userId = "m1test_t124_user";
  const orderProcessedId = "m1test_t124_order_proc";
  const orderFailedId = "m1test_t124_order_fail";
  const orderFreshId = "m1test_t124_order_fresh";
  const refProcessedId = "m1test_t124_ref_proc";
  const refFailedId = "m1test_t124_ref_fail";
  const refFreshId = "m1test_t124_ref_fresh";

  beforeAll(async () => {
    await cleanupM1TestRows();

    await prisma.user.create({
      data: {
        id: userId,
        email: "m1test_t124@example.com",
        name: "M1Test T124",
      },
    });

    const staleAt = new Date(Date.now() - 20 * 60 * 1000);
    const freshAt = new Date(Date.now() - 2 * 60 * 1000);

    await prisma.order.createMany({
      data: [
        {
          id: orderProcessedId,
          displayId: "m1test_T124_1",
          userId,
          customerName: "M1Test T124",
          customerEmail: "m1test_t124@example.com",
          customerPhone: "9999999124",
          shippingAddress: { line1: "1 Test St", city: "Mumbai", state: "MH", pincode: "400001" },
          subtotal: 100000,
          total: 100000,
          paymentMethod: "RAZORPAY",
          paymentStatus: "PAID",
          fulfilmentStatus: "CANCELLED",
          razorpayPaymentId: "pay_m1test_t124_1",
        },
        {
          id: orderFailedId,
          displayId: "m1test_T124_2",
          userId,
          customerName: "M1Test T124",
          customerEmail: "m1test_t124@example.com",
          customerPhone: "9999999124",
          shippingAddress: { line1: "1 Test St", city: "Mumbai", state: "MH", pincode: "400001" },
          subtotal: 50000,
          total: 50000,
          paymentMethod: "RAZORPAY",
          paymentStatus: "PAID",
          fulfilmentStatus: "CANCELLED",
          razorpayPaymentId: "pay_m1test_t124_2",
        },
        {
          id: orderFreshId,
          displayId: "m1test_T124_3",
          userId,
          customerName: "M1Test T124",
          customerEmail: "m1test_t124@example.com",
          customerPhone: "9999999124",
          shippingAddress: { line1: "1 Test St", city: "Mumbai", state: "MH", pincode: "400001" },
          subtotal: 50000,
          total: 50000,
          paymentMethod: "RAZORPAY",
          paymentStatus: "PAID",
          fulfilmentStatus: "CANCELLED",
          razorpayPaymentId: "pay_m1test_t124_3",
        },
      ],
    });

    await prisma.refund.createMany({
      data: [
        {
          id: refProcessedId,
          orderId: orderProcessedId,
          method: "RAZORPAY",
          status: "PENDING",
          amountPaise: 100000,
          idempotencyKey: "m1test_t124_idem_proc",
          initiatedAt: staleAt,
        },
        {
          id: refFailedId,
          orderId: orderFailedId,
          method: "RAZORPAY",
          status: "PENDING",
          amountPaise: 50000,
          idempotencyKey: "m1test_t124_idem_fail",
          initiatedAt: staleAt,
        },
        {
          id: refFreshId,
          orderId: orderFreshId,
          method: "RAZORPAY",
          status: "PENDING",
          amountPaise: 50000,
          idempotencyKey: "m1test_t124_idem_fresh",
          initiatedAt: freshAt,
        },
      ],
    });
  });

  afterAll(async () => {
    await cleanupM1TestRows();
  });

  it("recovers stale processed refunds, marks missing ones failed, and skips fresh ones", async () => {
    mockFetchMultipleRefund.mockImplementation(async (paymentId: string) => {
      if (paymentId === "pay_m1test_t124_1") {
        return {
          items: [
            {
              id: "rfnd_m1test_1",
              status: "processed",
              notes: { refundId: refProcessedId },
            },
          ],
        };
      }
      return { items: [] };
    });

    const res = await recoverInterruptedRefunds(new Date());
    expect(res.recoveredProcessed).toBe(1);
    expect(res.markedFailed).toBe(1);

    const refProc = await prisma.refund.findUniqueOrThrow({ where: { id: refProcessedId } });
    expect(refProc.status).toBe("PROCESSED");
    expect(refProc.providerRefundId).toBe("rfnd_m1test_1");

    const ordProc = await prisma.order.findUniqueOrThrow({ where: { id: orderProcessedId } });
    expect(ordProc.paymentStatus).toBe("REFUNDED");
    expect(ordProc.razorpayRefundId).toBe("rfnd_m1test_1");

    const refFail = await prisma.refund.findUniqueOrThrow({ where: { id: refFailedId } });
    expect(refFail.status).toBe("FAILED");
    expect(refFail.failureReason).toBeTruthy();

    const refFresh = await prisma.refund.findUniqueOrThrow({ where: { id: refFreshId } });
    expect(refFresh.status).toBe("PENDING");

    // Idempotent second run
    const res2 = await recoverInterruptedRefunds(new Date());
    expect(res2.recoveredProcessed).toBe(0);
    expect(res2.markedFailed).toBe(0);
  });
});
