import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma } from "../helpers/prisma";
import {
  createTestUser,
  createTestProduct,
  createTestOrder,
  cleanupM1TestRows,
} from "../helpers/fixtures";

let mockCurrentUser: { id: string; role: string } = { id: "default_user", role: "STAFF" };
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
  sendReturnRequestedEmail: vi.fn().mockResolvedValue({}),
  sendReturnApprovedEmail: vi.fn().mockResolvedValue({}),
  sendReturnRejectedEmail: vi.fn().mockResolvedValue({}),
  sendReturnReceivedEmail: vi.fn().mockResolvedValue({}),
  sendReturnRefundedEmail: vi.fn().mockResolvedValue({}),
  sendStoreCreditIssuedEmail: vi.fn().mockResolvedValue({}),
}));

vi.mock("@/lib/razorpay", () => ({
  getRazorpay: () => ({
    payments: {
      refund: mockRefund,
    },
  }),
}));

import {
  requestReturn,
  approveReturn,
  receiveReturn,
  refundReturn,
} from "@/lib/actions/returns";
import { issueInvoiceForOrder } from "@/lib/gst/issue-invoice";
import { sendReturnRefundedEmail } from "@/lib/email";

describe("T86: Return Refunds & Restock Invariants", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockRefund.mockResolvedValue({ id: "rfnd_m1test_default" });
    await cleanupM1TestRows();
  });

  afterEach(async () => {
    await cleanupM1TestRows();
  });

  it("1. approve -> receive (restock tick yes/no, stock changes exactly once, StockMovement rows) -> refund", async () => {
    const user = await createTestUser();
    mockCurrentUser = { id: user.id, role: "STAFF" };

    const { product: prodA, variants: varsA } = await createTestProduct({
      price: 100000,
      variants: [{ size: "M", stock: 5 }],
    });
    const { product: prodB, variants: varsB } = await createTestProduct({
      price: 150000,
      variants: [{ size: "L", stock: 10 }],
    });

    const order = await createTestOrder({
      userId: user.id,
      items: [
        { variantId: varsA[0].id, productId: prodA.id, qty: 1, unitPrice: 100000 },
        { variantId: varsB[0].id, productId: prodB.id, qty: 1, unitPrice: 150000 },
      ],
      status: "DELIVERED",
      paymentMethod: "COD",
      deliveredAt: new Date(),
    });

    const returnReq = await requestReturn({
      orderId: order.id,
      items: [
        { orderItemId: order.items[0].id, qty: 1 },
        { orderItemId: order.items[1].id, qty: 1 },
      ],
      reasonCode: "DEFECTIVE",
    });

    // 1. Approve return
    await approveReturn(returnReq.id, "Staff approved");

    // Stock must remain UNCHANGED at approval (still 5 and 10)
    const varAAfterApprove = await prisma.productVariant.findUnique({ where: { id: varsA[0].id } });
    const varBAfterApprove = await prisma.productVariant.findUnique({ where: { id: varsB[0].id } });
    expect(varAAfterApprove?.stock).toBe(5);
    expect(varBAfterApprove?.stock).toBe(10);

    // 2. Mark RECEIVED: Item A restocked (good), Item B NOT restocked (damaged)
    const returnItems = await prisma.returnItem.findMany({ where: { returnId: returnReq.id } });
    const itemA = returnItems.find((it) => it.orderItemId === order.items[0].id)!;
    const itemB = returnItems.find((it) => it.orderItemId === order.items[1].id)!;

    await receiveReturn(returnReq.id, [
      { returnItemId: itemA.id, restock: true, condition: "Unopened packaging" },
      { returnItemId: itemB.id, restock: false, condition: "Torn fabric - damaged" },
    ]);

    // Item A stock incremented to 6; Item B stock stays 10
    const varAAfterReceive = await prisma.productVariant.findUnique({ where: { id: varsA[0].id } });
    const varBAfterReceive = await prisma.productVariant.findUnique({ where: { id: varsB[0].id } });
    expect(varAAfterReceive?.stock).toBe(6);
    expect(varBAfterReceive?.stock).toBe(10);

    // Exactly one StockMovement for Item A, 0 for Item B
    const movementsA = await prisma.stockMovement.findMany({ where: { variantId: varsA[0].id } });
    expect(movementsA).toHaveLength(1);
    expect(movementsA[0].delta).toBe(1);
    expect(movementsA[0].reason).toBe("RETURN");

    const movementsB = await prisma.stockMovement.findMany({ where: { variantId: varsB[0].id } });
    expect(movementsB).toHaveLength(0);

    // Marking received again throws (cannot transition from RECEIVED)
    await expect(
      receiveReturn(returnReq.id, [{ returnItemId: itemA.id, restock: true }])
    ).rejects.toThrow("Cannot mark received from status RECEIVED");

    // 3. Refund return
    const refundRes = await refundReturn(returnReq.id);
    expect(refundRes.success).toBe(true);

    const finalReq = await prisma.returnRequest.findUnique({ where: { id: returnReq.id } });
    expect(finalReq?.status).toBe("REFUNDED");
  });

  it("2. Razorpay refund failure leaves Refund FAILED and retry with same key succeeds", async () => {
    const user = await createTestUser();
    mockCurrentUser = { id: user.id, role: "STAFF" };

    const { product, variants } = await createTestProduct({ price: 200000 });
    const order = await createTestOrder({
      userId: user.id,
      items: [{ variantId: variants[0].id, productId: product.id, qty: 1, unitPrice: 200000 }],
      status: "DELIVERED",
      paymentMethod: "RAZORPAY",
      razorpayPaymentId: "pay_m1test_retry_rzp",
      paidAt: new Date(),
      deliveredAt: new Date(),
    });

    const returnReq = await requestReturn({
      orderId: order.id,
      items: [{ orderItemId: order.items[0].id, qty: 1 }],
      reasonCode: "WRONG_SIZE",
    });

    await approveReturn(returnReq.id);
    const returnItems = await prisma.returnItem.findMany({ where: { returnId: returnReq.id } });
    await receiveReturn(returnReq.id, [{ returnItemId: returnItems[0].id, restock: true }]);

    // Mock Razorpay failure on first attempt
    mockRefund.mockRejectedValueOnce(new Error("Gateway connection timed out"));

    await expect(refundReturn(returnReq.id)).rejects.toThrow(/Gateway connection timed out/i);

    // Verify Refund row is FAILED in DB
    const failedRefund = await prisma.refund.findFirst({
      where: { returnId: returnReq.id },
    });
    expect(failedRefund).toBeDefined();
    expect(failedRefund?.status).toBe("FAILED");
    expect(failedRefund?.failureReason).toContain("Gateway connection timed out");

    // Retry with same key succeeds
    mockRefund.mockResolvedValueOnce({ id: "rfnd_m1test_recovered" });
    const retryRes = await refundReturn(returnReq.id);
    expect(retryRes.success).toBe(true);

    // Refund row is now PROCESSED with provider refund id
    const processedRefund = await prisma.refund.findFirst({
      where: { returnId: returnReq.id },
    });
    expect(processedRefund?.status).toBe("PROCESSED");
    expect(processedRefund?.providerRefundId).toBe("rfnd_m1test_recovered");
  });

  it("3. COD return issues store credit and parallel refund attempts yield single outcome", async () => {
    const user = await createTestUser({ storeCreditBalance: 0 });
    mockCurrentUser = { id: user.id, role: "STAFF" };

    const { product, variants } = await createTestProduct({ price: 150000 });
    const order = await createTestOrder({
      userId: user.id,
      items: [{ variantId: variants[0].id, productId: product.id, qty: 1, unitPrice: 150000 }],
      status: "DELIVERED",
      paymentMethod: "COD",
      deliveredAt: new Date(),
    });

    await prisma.$transaction(async (tx) => {
      await issueInvoiceForOrder(tx, order.id);
    });

    const returnReq = await requestReturn({
      orderId: order.id,
      items: [{ orderItemId: order.items[0].id, qty: 1 }],
      reasonCode: "CHANGED_MIND",
    });

    await approveReturn(returnReq.id);
    const returnItems = await prisma.returnItem.findMany({ where: { returnId: returnReq.id } });
    await receiveReturn(returnReq.id, [{ returnItemId: returnItems[0].id, restock: true }]);

    // Parallel refund calls
    const [p1, p2] = await Promise.allSettled([
      refundReturn(returnReq.id),
      refundReturn(returnReq.id),
    ]);

    // Exactly one succeeds, loser throws with "already being refunded"
    const succeeded = [p1, p2].filter((r) => r.status === "fulfilled");
    const failed = [p1, p2].filter((r) => r.status === "rejected");
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect((failed[0] as PromiseRejectedResult).reason?.message).toMatch(/already being refunded/i);

    // User store credit incremented exactly once (150000 paise)
    const updatedUser = await prisma.user.findUnique({ where: { id: user.id } });
    expect(updatedUser?.storeCreditBalance).toBe(150000);

    const refunds = await prisma.refund.findMany({ where: { returnId: returnReq.id } });
    expect(refunds).toHaveLength(1);
    expect(refunds[0].status).toBe("PROCESSED");
    expect(refunds[0].method).toBe("STORE_CREDIT");

    // Exactly one credit note and one email call
    const creditNotes = await prisma.creditNote.findMany({ where: { orderId: order.id } });
    expect(creditNotes).toHaveLength(1);
    expect(sendReturnRefundedEmail).toHaveBeenCalledTimes(1);
  });

  it("4. Partial then final return refunds fees only on final one, creates capped credit notes, updates payment status", async () => {
    const user = await createTestUser();
    mockCurrentUser = { id: user.id, role: "STAFF" };

    const { product: prod1, variants: var1 } = await createTestProduct({ price: 100000 });
    const { product: prod2, variants: var2 } = await createTestProduct({ price: 120000 });

    const order = await createTestOrder({
      userId: user.id,
      items: [
        { variantId: var1[0].id, productId: prod1.id, qty: 1, unitPrice: 100000 },
        { variantId: var2[0].id, productId: prod2.id, qty: 1, unitPrice: 120000 },
      ],
      shippingFee: 9900,
      total: 229900,
      status: "DELIVERED",
      paymentMethod: "RAZORPAY",
      razorpayPaymentId: "pay_m1test_multireturn",
      paidAt: new Date(),
      deliveredAt: new Date(),
    });

    // Issue initial tax invoice for the order
    await prisma.$transaction(async (tx) => {
      await issueInvoiceForOrder(tx, order.id);
    });

    // --- Return 1: Item 1 only (partial return) ---
    const req1 = await requestReturn({
      orderId: order.id,
      items: [{ orderItemId: order.items[0].id, qty: 1 }],
      reasonCode: "WRONG_SIZE",
    });

    await approveReturn(req1.id);
    const itms1 = await prisma.returnItem.findMany({ where: { returnId: req1.id } });
    await receiveReturn(req1.id, [{ returnItemId: itms1[0].id, restock: true }]);

    mockRefund.mockResolvedValueOnce({ id: "rfnd_part_1" });
    await refundReturn(req1.id);

    // Order payment status is PARTIALLY_REFUNDED
    const midOrder = await prisma.order.findUnique({
      where: { id: order.id },
      include: { refunds: true, creditNotes: true },
    });
    expect(midOrder?.paymentStatus).toBe("PARTIALLY_REFUNDED");
    expect(midOrder?.refundAmount).toBe(100000); // 100000 only, fees NOT refunded!
    expect(midOrder?.creditNotes).toHaveLength(1);
    expect(midOrder?.creditNotes[0].totalPaise).toBe(100000);

    // --- Return 2: Item 2 (completes full order return) ---
    const req2 = await requestReturn({
      orderId: order.id,
      items: [{ orderItemId: order.items[1].id, qty: 1 }],
      reasonCode: "CHANGED_MIND",
    });

    await approveReturn(req2.id);
    const itms2 = await prisma.returnItem.findMany({ where: { returnId: req2.id } });
    await receiveReturn(req2.id, [{ returnItemId: itms2[0].id, restock: true }]);

    mockRefund.mockResolvedValueOnce({ id: "rfnd_part_2" });
    await refundReturn(req2.id);

    // Final order payment status is REFUNDED
    const finalOrder = await prisma.order.findUnique({
      where: { id: order.id },
      include: { refunds: true, creditNotes: true },
    });
    expect(finalOrder?.paymentStatus).toBe("REFUNDED");
    expect(finalOrder?.refundAmount).toBe(229900); // 100000 + 120000 + 9900 fees = 229900 exactly!

    // Exactly 2 credit notes summing to 229900
    expect(finalOrder?.creditNotes).toHaveLength(2);
    const totalCreditNotesPaise = finalOrder?.creditNotes.reduce((s, cn) => s + cn.totalPaise, 0);
    expect(totalCreditNotesPaise).toBe(229900);

    // Cumulative refunds sum exactly to order total
    const totalRefunded = finalOrder?.refunds.reduce((s, r) => s + r.amountPaise, 0);
    expect(totalRefunded).toBe(229900);
  });

  it("5. COD-order complete return refunds shipping AND COD fee exactly once; partial returns never refund fees", async () => {
    const user = await createTestUser({ storeCreditBalance: 0 });
    mockCurrentUser = { id: user.id, role: "STAFF" };

    const { product: prod1, variants: var1 } = await createTestProduct({ price: 100000 });
    const { product: prod2, variants: var2 } = await createTestProduct({ price: 120000 });

    const order = await createTestOrder({
      userId: user.id,
      items: [
        { variantId: var1[0].id, productId: prod1.id, qty: 1, unitPrice: 100000 },
        { variantId: var2[0].id, productId: prod2.id, qty: 1, unitPrice: 120000 },
      ],
      shippingFee: 5000,
      codFee: 5000,
      total: 230000,
      status: "DELIVERED",
      paymentMethod: "COD",
      deliveredAt: new Date(),
    });

    await prisma.$transaction(async (tx) => {
      await issueInvoiceForOrder(tx, order.id);
    });

    // Step 1: Partial return (item 1 only)
    const req1 = await requestReturn({
      orderId: order.id,
      items: [{ orderItemId: order.items[0].id, qty: 1 }],
      reasonCode: "WRONG_SIZE",
    });
    await approveReturn(req1.id);
    const itms1 = await prisma.returnItem.findMany({ where: { returnId: req1.id } });
    await receiveReturn(req1.id, [{ returnItemId: itms1[0].id, restock: true }]);

    const res1 = await refundReturn(req1.id);
    expect(res1.success).toBe(true);
    expect(res1.refund.amountPaise).toBe(100000); // Only item price, no fees!

    const userAfterPart = await prisma.user.findUnique({ where: { id: user.id } });
    expect(userAfterPart?.storeCreditBalance).toBe(100000);

    const orderAfterPart = await prisma.order.findUnique({ where: { id: order.id } });
    expect(orderAfterPart?.feesRefunded).toBe(false);

    // Step 2: Second return (item 2, completes the order)
    const req2 = await requestReturn({
      orderId: order.id,
      items: [{ orderItemId: order.items[1].id, qty: 1 }],
      reasonCode: "DEFECTIVE",
    });
    await approveReturn(req2.id);
    const itms2 = await prisma.returnItem.findMany({ where: { returnId: req2.id } });
    await receiveReturn(req2.id, [{ returnItemId: itms2[0].id, restock: true }]);

    const res2 = await refundReturn(req2.id);
    expect(res2.success).toBe(true);
    // 120000 item + 5000 shipping + 5000 codFee = 130000
    expect(res2.refund.amountPaise).toBe(130000);

    const userAfterComplete = await prisma.user.findUnique({ where: { id: user.id } });
    expect(userAfterComplete?.storeCreditBalance).toBe(230000);

    const orderAfterComplete = await prisma.order.findUnique({
      where: { id: order.id },
      include: { refunds: true, creditNotes: true },
    });
    expect(orderAfterComplete?.feesRefunded).toBe(true);
    expect(orderAfterComplete?.paymentStatus).toBe("REFUNDED");
    expect(orderAfterComplete?.refundAmount).toBe(230000);

    // Credit notes cover all items and fees exactly once
    const totalCreditNotesPaise = orderAfterComplete?.creditNotes.reduce((s, cn) => s + cn.totalPaise, 0);
    expect(totalCreditNotesPaise).toBe(230000);
  });

  it("6. Failed Razorpay refund leaves return in RECEIVED with refundInitiatedAt null, retry succeeds once", async () => {
    const user = await createTestUser();
    mockCurrentUser = { id: user.id, role: "STAFF" };

    const { product, variants } = await createTestProduct({ price: 100000 });
    const order = await createTestOrder({
      userId: user.id,
      items: [{ variantId: variants[0].id, productId: product.id, qty: 1, unitPrice: 100000 }],
      total: 100000,
      status: "DELIVERED",
      paymentMethod: "RAZORPAY",
      razorpayPaymentId: "pay_m1test_fail_retry",
      paidAt: new Date(),
      deliveredAt: new Date(),
    });

    const returnReq = await requestReturn({
      orderId: order.id,
      items: [{ orderItemId: order.items[0].id, qty: 1 }],
      reasonCode: "CHANGED_MIND",
    });

    await approveReturn(returnReq.id);
    const returnItems = await prisma.returnItem.findMany({ where: { returnId: returnReq.id } });
    await receiveReturn(returnReq.id, [{ returnItemId: returnItems[0].id, restock: true }]);

    // Make Razorpay fail
    mockRefund.mockRejectedValueOnce(new Error("Gateway connection timed out"));

    await expect(refundReturn(returnReq.id)).rejects.toThrow(/Gateway connection timed out|Refund failed/i);

    // Check return is still RECEIVED and refundInitiatedAt is null
    const reqAfterFail = await prisma.returnRequest.findUnique({ where: { id: returnReq.id } });
    expect(reqAfterFail?.status).toBe("RECEIVED");
    expect(reqAfterFail?.refundInitiatedAt).toBeNull();

    // Check refund row in DB exists and is FAILED
    const failedRefund = await prisma.refund.findFirst({ where: { returnId: returnReq.id } });
    expect(failedRefund).toBeDefined();
    expect(failedRefund?.status).toBe("FAILED");

    // Staff retries refund with same idempotency key and Razorpay succeeds
    mockRefund.mockResolvedValueOnce({ id: "rfnd_m1test_success_retry" });

    const retryRes = await refundReturn(returnReq.id);
    expect(retryRes.success).toBe(true);

    const reqAfterRetry = await prisma.returnRequest.findUnique({ where: { id: returnReq.id } });
    expect(reqAfterRetry?.status).toBe("REFUNDED");
    expect(reqAfterRetry?.refundInitiatedAt).not.toBeNull();

    const finalRefunds = await prisma.refund.findMany({ where: { returnId: returnReq.id } });
    expect(finalRefunds).toHaveLength(1); // Same refund row was updated or idempotently handled
    expect(finalRefunds[0].status).toBe("PROCESSED");
    expect(finalRefunds[0].providerRefundId).toBe("rfnd_m1test_success_retry");
  });
});
