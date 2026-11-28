import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { cleanupM1TestRows } from "../helpers/fixtures";
import {
  LATE_CAPTURE_REFUND_OUTBOX_TYPE,
  buildLateCaptureRefundDedupeKey,
} from "@/lib/orders/late-capture-refund";

const mockRefundCreate = vi.fn();

vi.mock("@/lib/razorpay", () => ({
  getRazorpay: () => ({
    payments: {
      refund: mockRefundCreate,
    },
  }),
}));

import { markOrderPaid } from "@/lib/orders/mark-paid";
import { processOutboxBatch } from "@/lib/outbox/process";

describe("direct_t127_late_capture_refund", () => {
  const userId = "m1test_t127_user";
  const orderOkId = "m1test_t127_ord_ok";
  const orderFailId = "m1test_t127_ord_fail";

  beforeAll(async () => {
    await cleanupM1TestRows();

    await prisma.user.create({
      data: {
        id: userId,
        email: "m1test_t127@example.com",
        name: "M1Test T127",
      },
    });

    await prisma.order.createMany({
      data: [
        {
          id: orderOkId,
          displayId: "m1test_T127_OK",
          userId,
          customerName: "M1Test T127",
          customerEmail: "m1test_t127@example.com",
          customerPhone: "9999999127",
          shippingAddress: { line1: "1 Test St", city: "Mumbai", state: "MH", pincode: "400001" },
          subtotal: 75000,
          total: 75000,
          paymentMethod: "RAZORPAY",
          paymentStatus: "FAILED",
          fulfilmentStatus: "CANCELLED",
        },
        {
          id: orderFailId,
          displayId: "m1test_T127_FAIL",
          userId,
          customerName: "M1Test T127",
          customerEmail: "m1test_t127@example.com",
          customerPhone: "9999999127",
          shippingAddress: { line1: "1 Test St", city: "Mumbai", state: "MH", pincode: "400001" },
          subtotal: 50000,
          total: 50000,
          paymentMethod: "RAZORPAY",
          paymentStatus: "FAILED",
          fulfilmentStatus: "CANCELLED",
        },
      ],
    });
  });

  afterAll(async () => {
    await cleanupM1TestRows();
  });

  it("enqueues durable late-capture refund job, processes idempotently, and leaves failing jobs retriable", async () => {
    const paymentOk = "pay_m1test_t127_ok";
    await prisma.$transaction(async (tx) => {
      const res = await markOrderPaid(tx, orderOkId, paymentOk);
      expect(res.updated).toBe(false);
    });

    const dedupeKeyOk = buildLateCaptureRefundDedupeKey(orderOkId, paymentOk);
    const jobs = await prisma.eventOutbox.findMany({ where: { dedupeKey: dedupeKeyOk } });
    expect(jobs).toHaveLength(1);
    expect(jobs[0].type).toBe(LATE_CAPTURE_REFUND_OUTBOX_TYPE);

    mockRefundCreate.mockResolvedValueOnce({ id: "rfnd_m1test_t127_1" });
    await processOutboxBatch(25);
    expect(mockRefundCreate).toHaveBeenCalledTimes(1);

    // Second run issues no second refund
    await processOutboxBatch(25);
    expect(mockRefundCreate).toHaveBeenCalledTimes(1);

    const jobAfterOk = await prisma.eventOutbox.findUniqueOrThrow({ where: { dedupeKey: dedupeKeyOk } });
    expect(jobAfterOk.status).toBe("SENT");

    // Failing gateway leaves job PENDING and retriable
    const paymentFail = "pay_m1test_t127_fail";
    await prisma.$transaction(async (tx) => {
      await markOrderPaid(tx, orderFailId, paymentFail);
    });
    mockRefundCreate.mockRejectedValueOnce(new Error("Gateway 502"));
    await processOutboxBatch(25);

    const dedupeKeyFail = buildLateCaptureRefundDedupeKey(orderFailId, paymentFail);
    const jobAfterFail = await prisma.eventOutbox.findUniqueOrThrow({
      where: { dedupeKey: dedupeKeyFail },
    });
    expect(jobAfterFail.status).toBe("PENDING");
    expect(jobAfterFail.attempts).toBe(1);
    expect(jobAfterFail.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
  });
});
