import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma } from "../helpers/prisma";
import {
  createTestUser,
  createTestProduct,
  createTestOrder,
  cleanupM1TestRows,
} from "../helpers/fixtures";

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
  sendReturnRequestedEmail: vi.fn().mockResolvedValue({}),
  sendReturnApprovedEmail: vi.fn().mockResolvedValue({}),
  sendReturnRejectedEmail: vi.fn().mockResolvedValue({}),
  sendReturnReceivedEmail: vi.fn().mockResolvedValue({}),
  sendReturnRefundedEmail: vi.fn().mockResolvedValue({}),
  sendStoreCreditIssuedEmail: vi.fn().mockResolvedValue({}),
}));

import { requestReturn, cancelReturn } from "@/lib/actions/returns";

describe("T85: Return Requests Customer Invariants", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await cleanupM1TestRows();
  });

  afterEach(async () => {
    await cleanupM1TestRows();
  });

  it("1. Window open vs closed: orders past window days rejected", async () => {
    const user = await createTestUser();
    mockCurrentUser = { id: user.id, role: "CUSTOMER" };

    const { product, variants } = await createTestProduct({ price: 100000 });
    const variant = variants[0];

    // Order delivered 10 days ago (window is 7 days)
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const expiredOrder = await createTestOrder({
      userId: user.id,
      items: [{ variantId: variant.id, productId: product.id, qty: 1, unitPrice: 100000 }],
      status: "DELIVERED",
      deliveredAt: tenDaysAgo,
    });

    await expect(
      requestReturn({
        orderId: expiredOrder.id,
        items: [{ orderItemId: expiredOrder.items[0].id, qty: 1 }],
        reasonCode: "WRONG_SIZE",
      })
    ).rejects.toThrow(/return window for this order has expired/i);

    // Order delivered 2 days ago -> succeeds
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const validOrder = await createTestOrder({
      userId: user.id,
      items: [{ variantId: variant.id, productId: product.id, qty: 1, unitPrice: 100000 }],
      status: "DELIVERED",
      deliveredAt: twoDaysAgo,
    });

    const res = await requestReturn({
      orderId: validOrder.id,
      items: [{ orderItemId: validOrder.items[0].id, qty: 1 }],
      reasonCode: "DEFECTIVE",
      note: "Small tear near seam",
    });

    expect(res.status).toBe("REQUESTED");
    expect(res.items).toHaveLength(1);
    expect(res.items[0].qty).toBe(1);
  });

  it("2. Non-delivered and foreign orders are rejected", async () => {
    const user1 = await createTestUser();
    const user2 = await createTestUser();
    mockCurrentUser = { id: user1.id, role: "CUSTOMER" };

    const { product, variants } = await createTestProduct({ price: 100000 });
    const variant = variants[0];

    // SHIPPED order throws
    const shippedOrder = await createTestOrder({
      userId: user1.id,
      items: [{ variantId: variant.id, productId: product.id, qty: 1, unitPrice: 100000 }],
      status: "SHIPPED",
    });

    await expect(
      requestReturn({
        orderId: shippedOrder.id,
        items: [{ orderItemId: shippedOrder.items[0].id, qty: 1 }],
        reasonCode: "CHANGED_MIND",
      })
    ).rejects.toThrow("Returns can only be requested for delivered orders.");

    // Foreign order (user2's delivered order) throws unauthorized
    const user2Order = await createTestOrder({
      userId: user2.id,
      items: [{ variantId: variant.id, productId: product.id, qty: 1, unitPrice: 100000 }],
      status: "DELIVERED",
      deliveredAt: new Date(),
    });

    await expect(
      requestReturn({
        orderId: user2Order.id,
        items: [{ orderItemId: user2Order.items[0].id, qty: 1 }],
        reasonCode: "NOT_AS_DESCRIBED",
      })
    ).rejects.toThrow(/unauthorized/i);
  });

  it("3. Free gift lines (isGift) cannot be returned", async () => {
    const user = await createTestUser();
    mockCurrentUser = { id: user.id, role: "CUSTOMER" };

    const { product, variants } = await createTestProduct({ price: 100000 });
    const variant = variants[0];

    const order = await createTestOrder({
      userId: user.id,
      items: [
        { variantId: variant.id, productId: product.id, qty: 1, unitPrice: 100000 },
        { variantId: variant.id, productId: product.id, qty: 1, unitPrice: 0, isGift: true },
      ],
      status: "DELIVERED",
      deliveredAt: new Date(),
    });

    const giftItem = order.items.find((i) => i.isGift);
    expect(giftItem).toBeDefined();

    await expect(
      requestReturn({
        orderId: order.id,
        items: [{ orderItemId: giftItem!.id, qty: 1 }],
        reasonCode: "CHANGED_MIND",
      })
    ).rejects.toThrow(/free gift items .* cannot be returned/i);
  });

  it("4. Cumulative qty caps & parallel requests cannot exceed ordered quantity", async () => {
    const user = await createTestUser();
    mockCurrentUser = { id: user.id, role: "CUSTOMER" };

    const { product, variants } = await createTestProduct({ price: 100000 });
    const variant = variants[0];

    // Order with qty: 2
    const order = await createTestOrder({
      userId: user.id,
      items: [{ variantId: variant.id, productId: product.id, qty: 2, unitPrice: 100000 }],
      status: "DELIVERED",
      deliveredAt: new Date(),
    });
    const orderItemId = order.items[0].id;

    // First request returns 1 unit
    const req1 = await requestReturn({
      orderId: order.id,
      items: [{ orderItemId, qty: 1 }],
      reasonCode: "WRONG_SIZE",
    });
    expect(req1.status).toBe("REQUESTED");

    // Second request asking for 2 units throws (1 + 2 = 3 > 2)
    await expect(
      requestReturn({
        orderId: order.id,
        items: [{ orderItemId, qty: 2 }],
        reasonCode: "WRONG_SIZE",
      })
    ).rejects.toThrow(/exceeds ordered quantity/i);

    // Parallel race: two concurrent requests both asking for the remaining 1 unit
    // Exactly one must succeed, the other must throw exceeding quantity
    const [p1, p2] = await Promise.allSettled([
      requestReturn({
        orderId: order.id,
        items: [{ orderItemId, qty: 1 }],
        reasonCode: "DEFECTIVE",
      }),
      requestReturn({
        orderId: order.id,
        items: [{ orderItemId, qty: 1 }],
        reasonCode: "CHANGED_MIND",
      }),
    ]);

    const successes = [p1, p2].filter((r) => r.status === "fulfilled");
    const failures = [p1, p2].filter((r) => r.status === "rejected");

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect((failures[0] as PromiseRejectedResult).reason.message).toMatch(
      /exceeds ordered quantity/i
    );
  });

  it("5. Customer can cancel only while REQUESTED", async () => {
    const user = await createTestUser();
    mockCurrentUser = { id: user.id, role: "CUSTOMER" };

    const { product, variants } = await createTestProduct({ price: 100000 });
    const variant = variants[0];

    const order = await createTestOrder({
      userId: user.id,
      items: [{ variantId: variant.id, productId: product.id, qty: 1, unitPrice: 100000 }],
      status: "DELIVERED",
      deliveredAt: new Date(),
    });

    const returnReq = await requestReturn({
      orderId: order.id,
      items: [{ orderItemId: order.items[0].id, qty: 1 }],
      reasonCode: "CHANGED_MIND",
    });

    // Customer cancels return
    const cancelRes = await cancelReturn(returnReq.id);
    expect(cancelRes.success).toBe(true);

    const cancelledReq = await prisma.returnRequest.findUnique({
      where: { id: returnReq.id },
    });
    expect(cancelledReq?.status).toBe("CANCELLED");

    // Cancelling again throws
    await expect(cancelReturn(returnReq.id)).rejects.toThrow(
      "Return requests can only be cancelled while in REQUESTED status"
    );
  });

  it("6. Backfilled legacy return is visible and queryable with ReturnItem", async () => {
    const legacyReturns = await prisma.returnRequest.findMany({
      where: { NOT: { id: { startsWith: "m1test" } } },
      include: { items: true },
    });

    // From migration 19 backfill, at least 1 legacy return exists
    expect(legacyReturns.length).toBeGreaterThanOrEqual(1);
    const legacy = legacyReturns[0];
    expect(legacy.items.length).toBeGreaterThanOrEqual(1);
    expect(legacy.items[0].qty).toBeGreaterThan(0);
    expect(legacy.items[0].condition).toBe("LEGACY_WHOLE_ORDER_RETURN");
  });
});
