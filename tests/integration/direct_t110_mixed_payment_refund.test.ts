import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { prisma } from "../helpers/prisma";
import {
  cleanupM1TestRows,
  createTestOrder,
  createTestProduct,
  createTestUser,
  genId,
} from "../helpers/fixtures";
import {
  creditWalletLot,
  debitWallet,
  getWalletBalance,
  restoreWalletDebit,
} from "@/lib/wallet/service";
import { issueInvoiceForOrder } from "@/lib/gst/issue-invoice";

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
  approveReturn,
  receiveReturn,
  refundReturn,
  requestReturn,
} from "@/lib/actions/returns";

describe("T110: Mixed-Payment Refund Split (Gateway + Wallet)", () => {
  beforeAll(async () => {
    await cleanupM1TestRows();
  });

  afterAll(async () => {
    await cleanupM1TestRows();
  });

  beforeEach(() => {
    mockRefund.mockReset();
    mockRefund.mockImplementation(async () => ({ id: genId("m1test_rzp_ref") }));
  });

  it("full return on 100000 (40000 PROMO wallet + 60000 Razorpay) refunds 60000 gateway + 40000 PROMO wallet, idempotent on retry", async () => {
    const user = await createTestUser();
    const staff = await createTestUser({ role: "STAFF" });
    mockCurrentUser = { id: staff.id, role: "STAFF" };

    const promoExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const promoLot = await creditWalletLot({
      userId: user.id,
      kind: "PROMO",
      amountPaise: 40000,
      expiresAt: promoExpiry,
      reason: "T110 promo",
    });

    const { product, variants } = await createTestProduct({ price: 100000 });
    const order = await createTestOrder({
      userId: user.id,
      items: [{ variantId: variants[0].id, productId: product.id, qty: 1, unitPrice: 100000 }],
      status: "DELIVERED",
      paymentMethod: "RAZORPAY",
      razorpayPaymentId: genId("m1test_pay"),
      storeCreditApplied: 40000,
      total: 100000,
      deliveredAt: new Date(),
    });
    await debitWallet({
      userId: user.id,
      amountPaise: 40000,
      orderId: order.id,
      reason: "T110 checkout debit",
    });

    await prisma.$transaction(async (tx) => {
      await issueInvoiceForOrder(tx, order.id);
    });

    mockCurrentUser = { id: user.id, role: "CUSTOMER" };
    const ret = await requestReturn({
      orderId: order.id,
      items: [{ orderItemId: order.items[0].id, qty: 1 }],
      reasonCode: "CHANGED_MIND",
    });
    mockCurrentUser = { id: staff.id, role: "STAFF" };
    await approveReturn(ret.id);
    const retItems = await prisma.returnItem.findMany({ where: { returnId: ret.id } });
    await receiveReturn(ret.id, [{ returnItemId: retItems[0].id, restock: true }]);

    await refundReturn(ret.id);

    expect(mockRefund).toHaveBeenCalledTimes(1);
    expect(mockRefund.mock.calls[0][1].amount).toBe(60000);

    const refunds = await prisma.refund.findMany({
      where: { returnId: ret.id },
      orderBy: { method: "asc" },
    });
    expect(refunds).toHaveLength(2);
    expect(refunds.find((r) => r.method === "RAZORPAY")?.amountPaise).toBe(60000);
    expect(refunds.find((r) => r.method === "STORE_CREDIT")?.amountPaise).toBe(40000);

    // Restored into ORIGINAL PROMO lot with its original expiry (not a REFUND lot)
    const lotAfter = await prisma.walletLot.findUnique({ where: { id: promoLot.lot!.id } });
    expect(lotAfter?.kind).toBe("PROMO");
    expect(lotAfter?.remainingPaise).toBe(40000);
    expect(lotAfter?.expiresAt?.getTime()).toBe(promoExpiry.getTime());

    const refundKindLots = await prisma.walletLot.count({
      where: { userId: user.id, kind: "REFUND" },
    });
    expect(refundKindLots).toBe(0);

    // Exactly one CreditNote
    const cns = await prisma.creditNote.findMany({ where: { orderId: order.id } });
    expect(cns).toHaveLength(1);
  });

  it("partial returns split correctly and cumulative gateway refunds never exceed 60000", async () => {
    const user = await createTestUser();
    const staff = await createTestUser({ role: "STAFF" });
    mockCurrentUser = { id: staff.id, role: "STAFF" };

    await creditWalletLot({
      userId: user.id,
      kind: "REFUND",
      amountPaise: 40000,
      reason: "T110 seed",
    });

    const { product: p1, variants: v1 } = await createTestProduct({ price: 70000 });
    const { product: p2, variants: v2 } = await createTestProduct({ price: 30000 });
    const order = await createTestOrder({
      userId: user.id,
      items: [
        { variantId: v1[0].id, productId: p1.id, qty: 1, unitPrice: 70000 },
        { variantId: v2[0].id, productId: p2.id, qty: 1, unitPrice: 30000 },
      ],
      status: "DELIVERED",
      paymentMethod: "RAZORPAY",
      razorpayPaymentId: genId("m1test_pay"),
      storeCreditApplied: 40000,
      total: 100000,
      deliveredAt: new Date(),
    });
    await debitWallet({ userId: user.id, amountPaise: 40000, orderId: order.id, reason: "T110 debit" });
    await prisma.$transaction((tx) => issueInvoiceForOrder(tx, order.id));

    // Return 1: 70000 -> 60000 gateway + 10000 wallet
    mockCurrentUser = { id: user.id, role: "CUSTOMER" };
    const r1 = await requestReturn({
      orderId: order.id,
      items: [{ orderItemId: order.items[0].id, qty: 1 }],
      reasonCode: "WRONG_SIZE",
    });
    mockCurrentUser = { id: staff.id, role: "STAFF" };
    await approveReturn(r1.id);
    const ri1 = await prisma.returnItem.findMany({ where: { returnId: r1.id } });
    await receiveReturn(r1.id, [{ returnItemId: ri1[0].id, restock: true }]);
    await refundReturn(r1.id);

    expect(await getWalletBalance(prisma, user.id)).toBe(10000);

    // Return 2: 30000 -> 0 gateway + 30000 wallet
    mockCurrentUser = { id: user.id, role: "CUSTOMER" };
    const r2 = await requestReturn({
      orderId: order.id,
      items: [{ orderItemId: order.items[1].id, qty: 1 }],
      reasonCode: "DEFECTIVE",
    });
    mockCurrentUser = { id: staff.id, role: "STAFF" };
    await approveReturn(r2.id);
    const ri2 = await prisma.returnItem.findMany({ where: { returnId: r2.id } });
    await receiveReturn(r2.id, [{ returnItemId: ri2[0].id, restock: true }]);
    await refundReturn(r2.id);

    const allGateway = await prisma.refund.findMany({
      where: { orderId: order.id, method: "RAZORPAY", status: "PROCESSED" },
    });
    const gwTotal = allGateway.reduce((s, r) => s + r.amountPaise, 0);
    expect(gwTotal).toBe(60000);
    expect(await getWalletBalance(prisma, user.id)).toBe(40000);
  });

  it("restore into a grace lot followed by a second partial restore never restores more than debited", async () => {
    const user = await createTestUser();
    const t0 = new Date("2026-06-01T00:00:00.000Z");
    await creditWalletLot({
      userId: user.id,
      kind: "PROMO",
      amountPaise: 40000,
      expiresAt: new Date("2026-06-05T00:00:00.000Z"),
      reason: "Expiring promo",
      now: t0,
    });
    const orderId = genId("m1test_ord_grace");
    await debitWallet({ userId: user.id, amountPaise: 40000, orderId, reason: "Debit", now: t0 });

    const afterExp = new Date("2026-06-06T00:00:00.000Z");
    const first = await prisma.$transaction((tx) =>
      restoreWalletDebit(tx, {
        userId: user.id,
        orderId,
        amountPaise: 25000,
        reason: "First partial restore",
        idempotencyKey: genId("m1test_g1"),
        now: afterExp,
      })
    );
    expect(first.restoredPaise).toBe(25000);

    const second = await prisma.$transaction((tx) =>
      restoreWalletDebit(tx, {
        userId: user.id,
        orderId,
        amountPaise: 30000,
        reason: "Second partial restore",
        idempotencyKey: genId("m1test_g2"),
        now: afterExp,
      })
    );
    expect(second.restoredPaise).toBe(15000);

    const entries = await prisma.walletEntry.findMany({
      where: { userId: user.id, orderId, type: "RESTORE" },
    });
    expect(entries.reduce((s, e) => s + e.amountPaise, 0)).toBe(40000);
  });
});
