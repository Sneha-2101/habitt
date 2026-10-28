import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import crypto from "crypto";
import { prisma } from "./helpers/prisma";
import {
  createTestUser,
  createTestProduct,
  createTestCoupon,
  createTestOrder,
  cleanupM1TestRows,
} from "./helpers/fixtures";

// Setup mocks
let mockCurrentUser: { id: string; role: string } = { id: "default_user", role: "CUSTOMER" };
const mockRefund = vi.fn();

vi.mock("@/lib/guards", () => ({
  requireUser: vi.fn(async () => mockCurrentUser),
  requireStaff: vi.fn(async () => mockCurrentUser),
  requireRole: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/email", () => ({
  sendCancellationEmail: vi.fn().mockResolvedValue({}),
}));

vi.mock("@/lib/razorpay", () => ({
  getRazorpay: () => ({
    payments: {
      refund: mockRefund,
    },
  }),
}));

import { cancelOrderAsCustomer } from "@/lib/actions/cancellation";

describe("T13: Cancellation Logic & Stock Integrity", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockRefund.mockResolvedValue({ id: "rfnd_m1test" });
    await cleanupM1TestRows();
  });

  afterEach(async () => {
    await cleanupM1TestRows();
  });

  it("T13 cancel: PENDING Razorpay order cancelled -> stock UNCHANGED, credit & coupon released", async () => {
    const user = await createTestUser({ storeCreditBalance: 0 });
    mockCurrentUser = { id: user.id, role: "CUSTOMER" };

    const { product, variants } = await createTestProduct({ price: 100000, variants: [{ size: "M", stock: 5 }] });
    const variant = variants[0];
    const coupon = await createTestCoupon({ usageLimit: 1, value: 10, timesUsed: 1 });

    // Order is PENDING Razorpay with stockDeducted = false (stock was NOT deducted at order creation)
    const order = await createTestOrder({
      userId: user.id,
      items: [{ variantId: variant.id, productId: product.id, qty: 2, unitPrice: 100000 }],
      status: "PENDING",
      paymentMethod: "RAZORPAY",
      stockDeducted: false,
      storeCreditApplied: 10000,
      couponCode: coupon.code,
    });

    await cancelOrderAsCustomer(order.id, "Customer changed mind");

    // Order status is CANCELLED
    const cancelledOrder = await prisma.order.findUnique({ where: { id: order.id } });
    expect(cancelledOrder?.status).toBe("CANCELLED");

    // Stock must be UNCHANGED (still 5, NOT inflated to 7!)
    const checkedVariant = await prisma.productVariant.findUnique({ where: { id: variant.id } });
    expect(checkedVariant?.stock).toBe(5);

    // No stock movements
    const movements = await prisma.stockMovement.findMany({ where: { variantId: variant.id } });
    expect(movements).toHaveLength(0);

    // Store credit restored
    const updatedUser = await prisma.user.findUnique({ where: { id: user.id } });
    expect(updatedUser?.storeCreditBalance).toBe(10000);

    // Coupon usage released
    const updatedCoupon = await prisma.coupon.findUnique({ where: { id: coupon.id } });
    expect(updatedCoupon?.timesUsed).toBe(0);

    // Refund was NOT called because it wasn't paid
    expect(mockRefund).not.toHaveBeenCalled();
  });

  it("T13 cancel: PAID order cancelled -> stock restored, stockDeducted false, refund called once", async () => {
    const user = await createTestUser();
    mockCurrentUser = { id: user.id, role: "CUSTOMER" };

    const { product, variants } = await createTestProduct({ price: 100000, variants: [{ size: "M", stock: 3 }] });
    const variant = variants[0];

    // Order is PAID Razorpay with stockDeducted = true
    const order = await createTestOrder({
      userId: user.id,
      items: [{ variantId: variant.id, productId: product.id, qty: 2, unitPrice: 100000 }],
      status: "PAID",
      paymentMethod: "RAZORPAY",
      stockDeducted: true,
      razorpayPaymentId: "pay_m1test_12345",
      paidAt: new Date(),
    });

    await cancelOrderAsCustomer(order.id, "Cancel paid order");

    // Stock restored from 3 to 5
    const checkedVariant = await prisma.productVariant.findUnique({ where: { id: variant.id } });
    expect(checkedVariant?.stock).toBe(5);

    // Order updated: status CANCELLED, stockDeducted false, refundId recorded
    const cancelledOrder = await prisma.order.findUnique({ where: { id: order.id } });
    expect(cancelledOrder?.status).toBe("CANCELLED");
    expect(cancelledOrder?.stockDeducted).toBe(false);
    expect(cancelledOrder?.razorpayRefundId).toBe("rfnd_m1test");

    // Exactly one CANCEL StockMovement
    const movements = await prisma.stockMovement.findMany({ where: { variantId: variant.id } });
    expect(movements).toHaveLength(1);
    expect(movements[0].delta).toBe(2);
    expect(movements[0].reason).toBe("CANCEL");

    // Refund was called once
    expect(mockRefund).toHaveBeenCalledTimes(1);
  });

  it("T13 cancel: refund throws -> order still CANCELLED, event has REFUND FAILED", async () => {
    const user = await createTestUser();
    mockCurrentUser = { id: user.id, role: "CUSTOMER" };

    const { product, variants } = await createTestProduct({ price: 100000, variants: [{ size: "M", stock: 3 }] });
    const variant = variants[0];

    mockRefund.mockRejectedValue(new Error("Razorpay gateway timeout"));

    const order = await createTestOrder({
      userId: user.id,
      items: [{ variantId: variant.id, productId: product.id, qty: 1, unitPrice: 100000 }],
      status: "PAID",
      paymentMethod: "RAZORPAY",
      stockDeducted: true,
      razorpayPaymentId: "pay_m1test_throw",
      paidAt: new Date(),
    });

    // Does not throw to caller
    await cancelOrderAsCustomer(order.id, "Cancel with failing refund");

    // Order is still CANCELLED
    const cancelledOrder = await prisma.order.findUnique({ where: { id: order.id } });
    expect(cancelledOrder?.status).toBe("CANCELLED");

    // OrderStatusEvent logged with REFUND FAILED
    const events = await prisma.orderStatusEvent.findMany({ where: { orderId: order.id } });
    expect(events.some((e) => e.note?.includes("REFUND FAILED"))).toBe(true);
  });

  it("T13 cancel: two parallel cancels -> one succeeds, other throws already changed", async () => {
    const user = await createTestUser();
    mockCurrentUser = { id: user.id, role: "CUSTOMER" };

    const { product, variants } = await createTestProduct({ price: 100000, variants: [{ size: "M", stock: 3 }] });
    const variant = variants[0];

    const order = await createTestOrder({
      userId: user.id,
      items: [{ variantId: variant.id, productId: product.id, qty: 1, unitPrice: 100000 }],
      status: "PAID",
      paymentMethod: "RAZORPAY",
      stockDeducted: true,
      razorpayPaymentId: "pay_m1test_parallel",
      paidAt: new Date(),
    });

    const results = await Promise.allSettled([
      cancelOrderAsCustomer(order.id, "Cancel race 1"),
      cancelOrderAsCustomer(order.id, "Cancel race 2"),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const rejReason = (rejected[0] as PromiseRejectedResult).reason;
    expect(rejReason?.message).toContain("already changed");

    // Refund called only once
    expect(mockRefund).toHaveBeenCalledTimes(1);

    // Stock incremented only once
    const checkedVariant = await prisma.productVariant.findUnique({ where: { id: variant.id } });
    expect(checkedVariant?.stock).toBe(4);
  });

  it("T13 cancel: unauthorized customer or SHIPPED status throws", async () => {
    const ownerUser = await createTestUser();
    const otherUser = await createTestUser();

    const { product, variants } = await createTestProduct({ price: 100000, variants: [{ size: "M", stock: 5 }] });
    const variant = variants[0];

    const order = await createTestOrder({
      userId: ownerUser.id,
      items: [{ variantId: variant.id, productId: product.id, qty: 1, unitPrice: 100000 }],
      status: "PAID",
      paymentMethod: "RAZORPAY",
      stockDeducted: true,
    });

    // 1. Another customer tries to cancel -> throws
    mockCurrentUser = { id: otherUser.id, role: "CUSTOMER" };
    await expect(cancelOrderAsCustomer(order.id, "Hacker cancel")).rejects.toThrow(
      "Unauthorized: Order does not belong to you"
    );

    // 2. SHIPPED order -> throws
    mockCurrentUser = { id: ownerUser.id, role: "CUSTOMER" };
    await prisma.order.update({
      where: { id: order.id },
      data: { status: "SHIPPED" },
    });

    await expect(cancelOrderAsCustomer(order.id, "Cancel shipped")).rejects.toThrow(
      "Order cannot be cancelled from status SHIPPED"
    );
  });
});
