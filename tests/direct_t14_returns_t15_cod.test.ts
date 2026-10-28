import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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

vi.mock("@/lib/guards", () => ({
  requireUser: vi.fn(async () => mockCurrentUser),
  requireStaff: vi.fn(async () => mockCurrentUser),
  requireRole: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/email", () => ({
  sendStoreCreditIssuedEmail: vi.fn().mockResolvedValue({}),
}));

import { requestReturn, approveReturn, rejectReturn } from "@/lib/actions/returns";
import { markCodRefused } from "@/lib/actions/cod-refusal";

describe("T14 & T15: Returns and COD Refusal", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await cleanupM1TestRows();
  });

  afterEach(async () => {
    await cleanupM1TestRows();
  });

  it("T14 returns: parallel approveReturn -> store credit & stock restored once, reject after approval throws, non-delivered throws", async () => {
    const user = await createTestUser({ storeCreditBalance: 0 });
    mockCurrentUser = { id: user.id, role: "STAFF" };

    const { product, variants } = await createTestProduct({ price: 100000, variants: [{ size: "M", stock: 3 }] });
    const variant = variants[0];

    // 1. requestReturn on a non-delivered order (e.g. SHIPPED) throws
    const shippedOrder = await createTestOrder({
      userId: user.id,
      items: [{ variantId: variant.id, productId: product.id, qty: 1, unitPrice: 100000 }],
      status: "SHIPPED",
      paymentMethod: "COD",
      stockDeducted: true,
    });

    mockCurrentUser = { id: user.id, role: "CUSTOMER" };
    await expect(requestReturn(shippedOrder.id, "Fit issue")).rejects.toThrow(
      "Returns can only be requested for delivered orders."
    );

    // 2. Deliver the order and create return request
    await prisma.order.update({
      where: { id: shippedOrder.id },
      data: { status: "DELIVERED", deliveredAt: new Date() },
    });

    const returnReq = await requestReturn(shippedOrder.id, "Defective item");
    expect(returnReq.status).toBe("REQUESTED");

    // 3. Parallel approveReturn -> exactly one succeeds, other throws
    mockCurrentUser = { id: user.id, role: "STAFF" };

    const [res1, res2] = await Promise.allSettled([
      approveReturn(returnReq.id, "Admin approve 1"),
      approveReturn(returnReq.id, "Admin approve 2"),
    ]);

    const fulfilled = [res1, res2].filter((r) => r.status === "fulfilled");
    const rejected = [res1, res2].filter((r) => r.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const rejReason = (rejected[0] as PromiseRejectedResult).reason;
    expect(rejReason?.message).toContain("already processed");

    // Order status is CANCELLED
    const cancelledOrder = await prisma.order.findUnique({ where: { id: shippedOrder.id } });
    expect(cancelledOrder?.status).toBe("CANCELLED");
    expect(cancelledOrder?.stockDeducted).toBe(false);

    // Stock incremented from 3 to 4 (once only)
    const checkedVariant = await prisma.productVariant.findUnique({ where: { id: variant.id } });
    expect(checkedVariant?.stock).toBe(4);

    // Exactly one RETURN StockMovement
    const movements = await prisma.stockMovement.findMany({ where: { variantId: variant.id } });
    expect(movements).toHaveLength(1);
    expect(movements[0].delta).toBe(1);
    expect(movements[0].reason).toBe("RETURN");

    // Store credit voucher issued exactly once for COD return (100000 paise)
    const updatedUser = await prisma.user.findUnique({ where: { id: user.id } });
    expect(updatedUser?.storeCreditBalance).toBe(100000);

    const creditTxs = await prisma.storeCreditTransaction.findMany({ where: { userId: user.id } });
    expect(creditTxs).toHaveLength(1);
    expect(creditTxs[0].amount).toBe(100000);

    // 4. rejectReturn after approval throws
    await expect(rejectReturn(returnReq.id, "Too late")).rejects.toThrow(
      "Return request already processed"
    );
  });

  it("T15 COD refusal: SHIPPED COD order cancelled, stock restored only if deducted, credit & coupon released, non-COD throws", async () => {
    const user = await createTestUser({ storeCreditBalance: 0 });
    mockCurrentUser = { id: user.id, role: "STAFF" };

    const { product, variants } = await createTestProduct({ price: 100000, variants: [{ size: "M", stock: 2 }] });
    const variant = variants[0];
    const coupon = await createTestCoupon({ usageLimit: 1, value: 10, timesUsed: 1 });

    // 1. Non-COD order throws
    const razorpayOrder = await createTestOrder({
      userId: user.id,
      items: [{ variantId: variant.id, productId: product.id, qty: 1, unitPrice: 100000 }],
      status: "SHIPPED",
      paymentMethod: "RAZORPAY",
      stockDeducted: true,
    });

    await expect(markCodRefused(razorpayOrder.id, "Customer refused")).rejects.toThrow(
      "Only COD orders can be marked as Refused / RTO"
    );

    // 2. SHIPPED COD order with store credit & coupon
    const codOrder = await createTestOrder({
      userId: user.id,
      items: [{ variantId: variant.id, productId: product.id, qty: 1, unitPrice: 100000 }],
      status: "SHIPPED",
      paymentMethod: "COD",
      stockDeducted: true,
      storeCreditApplied: 15000,
      couponCode: coupon.code,
    });

    await markCodRefused(codOrder.id, "Customer rejected delivery at door");

    // Order status CANCELLED, stockDeducted false
    const cancelledCod = await prisma.order.findUnique({ where: { id: codOrder.id } });
    expect(cancelledCod?.status).toBe("CANCELLED");
    expect(cancelledCod?.stockDeducted).toBe(false);

    // Stock restored from 2 to 3
    const checkedVariant = await prisma.productVariant.findUnique({ where: { id: variant.id } });
    expect(checkedVariant?.stock).toBe(3);

    // Exactly one RTO StockMovement
    const movements = await prisma.stockMovement.findMany({ where: { variantId: variant.id } });
    expect(movements).toHaveLength(1);
    expect(movements[0].delta).toBe(1);
    expect(movements[0].reason).toBe("RTO");

    // Store credit restored (15000)
    const updatedUser = await prisma.user.findUnique({ where: { id: user.id } });
    expect(updatedUser?.storeCreditBalance).toBe(15000);

    // Coupon released back to 0
    const updatedCoupon = await prisma.coupon.findUnique({ where: { id: coupon.id } });
    expect(updatedCoupon?.timesUsed).toBe(0);

    // 3. Second call throws
    await expect(markCodRefused(codOrder.id, "Call again")).rejects.toThrow(
      "Order cannot be marked refused from status CANCELLED"
    );
  });
});
