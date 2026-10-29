import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import crypto from "crypto";
import { prisma } from "../helpers/prisma";
import {
  createTestUser,
  createTestProduct,
  createTestCoupon,
  createTestOrder,
  cleanupM1TestRows,
} from "../helpers/fixtures";

vi.mock("@/lib/email", () => ({
  sendOrderConfirmationEmail: vi.fn().mockResolvedValue({}),
  sendAbandonedCartEmail: vi.fn().mockResolvedValue({}),
  sendBirthdayDiscountEmail: vi.fn().mockResolvedValue({}),
}));

import { GET as closeStaleOrdersHandler } from "@/app/api/cron/close-stale-orders/route";
import { GET as abandonedCartHandler } from "@/app/api/cron/abandoned-cart/route";
import { GET as birthdayDiscountHandler } from "@/app/api/cron/birthday-discount/route";

describe("T12: Cron Handlers Auth & Execution", () => {
  const originalCronSecret = process.env.CRON_SECRET;

  beforeEach(async () => {
    process.env.CRON_SECRET = "test_cron_secret";
    await cleanupM1TestRows();
  });

  afterEach(async () => {
    process.env.CRON_SECRET = originalCronSecret;
    await cleanupM1TestRows();
  });

  it("T12 cron auth: 401 without header, 401 with wrong secret, 500 when unset across all three routes", async () => {
    const handlers = [
      { name: "close-stale-orders", fn: closeStaleOrdersHandler },
      { name: "abandoned-cart", fn: abandonedCartHandler },
      { name: "birthday-discount", fn: birthdayDiscountHandler },
    ];

    for (const h of handlers) {
      // 1. Without Authorization header -> 401
      const noHeaderReq = new Request("http://localhost/api/cron");
      const resNoHeader = await h.fn(noHeaderReq);
      expect(resNoHeader.status, `${h.name} without header`).toBe(401);

      // 2. Wrong secret -> 401
      const wrongSecretReq = new Request("http://localhost/api/cron", {
        headers: { authorization: "Bearer wrong_secret_value" },
      });
      const resWrongSecret = await h.fn(wrongSecretReq);
      expect(resWrongSecret.status, `${h.name} with wrong secret`).toBe(401);

      // 3. CRON_SECRET unset -> 500
      delete process.env.CRON_SECRET;
      const unsetReq = new Request("http://localhost/api/cron", {
        headers: { authorization: "Bearer test_cron_secret" },
      });
      const resUnset = await h.fn(unsetReq);
      expect(resUnset.status, `${h.name} with unset CRON_SECRET`).toBe(500);

      // Restore for next loop
      process.env.CRON_SECRET = "test_cron_secret";
    }
  });

  it("T12 close-stale-orders: backdated 3h order FAILED and restored, 1h order untouched", async () => {
    const user = await createTestUser({ storeCreditBalance: 0 });
    const { product, variants } = await createTestProduct({ price: 100000, variants: [{ size: "M", stock: 10 }] });
    const variant = variants[0];
    const coupon = await createTestCoupon({ usageLimit: 1, value: 10 });

    // Mark coupon used once
    await prisma.coupon.update({
      where: { id: coupon.id },
      data: { timesUsed: 1 },
    });

    // 1. Order backdated 3 hours (RAZORPAY, PENDING, storeCreditApplied = 20000, couponCode set)
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);
    const staleOrder = await createTestOrder({
      userId: user.id,
      items: [{ variantId: variant.id, productId: product.id, qty: 1, unitPrice: 100000 }],
      status: "PENDING",
      paymentMethod: "RAZORPAY",
      stockDeducted: false,
      storeCreditApplied: 20000,
      couponCode: coupon.code,
      createdAt: threeHoursAgo,
    });

    // 2. Order 1 hour old (RAZORPAY, PENDING)
    const oneHourAgo = new Date(Date.now() - 1 * 60 * 60 * 1000);
    const freshOrder = await createTestOrder({
      userId: user.id,
      items: [{ variantId: variant.id, productId: product.id, qty: 1, unitPrice: 100000 }],
      status: "PENDING",
      paymentMethod: "RAZORPAY",
      stockDeducted: false,
      createdAt: oneHourAgo,
    });

    // Run close-stale-orders cron
    const req = new Request("http://localhost/api/cron/close-stale-orders", {
      headers: { authorization: "Bearer test_cron_secret" },
    });
    const res = await closeStaleOrdersHandler(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.closedCount).toBe(1);

    // Stale order should be FAILED
    const updatedStale = await prisma.order.findUnique({ where: { id: staleOrder.id } });
    expect(updatedStale?.status).toBe("FAILED");

    // Fresh order should still be PENDING
    const updatedFresh = await prisma.order.findUnique({ where: { id: freshOrder.id } });
    expect(updatedFresh?.status).toBe("PENDING");

    // Store credit restored to user
    const updatedUser = await prisma.user.findUnique({ where: { id: user.id } });
    expect(updatedUser?.storeCreditBalance).toBe(20000);

    // StoreCreditTransaction created
    const creditTxs = await prisma.storeCreditTransaction.findMany({ where: { userId: user.id } });
    expect(creditTxs).toHaveLength(1);
    expect(creditTxs[0].amount).toBe(20000);

    // Coupon timesUsed decremented back to 0
    const updatedCoupon = await prisma.coupon.findUnique({ where: { id: coupon.id } });
    expect(updatedCoupon?.timesUsed).toBe(0);
  });

  it("T12 abandoned-cart: emails only RAZORPAY PENDING/FAILED in window, never COD, deduplicated", async () => {
    const user = await createTestUser();
    const { product, variants } = await createTestProduct({ price: 100000, variants: [{ size: "M", stock: 10 }] });
    const variant = variants[0];

    // Settings delay is default 24 hours. Window is between 25h ago and 71h ago.
    const insideWindow = new Date(Date.now() - 25 * 60 * 60 * 1000);

    // 1. Eligible order: RAZORPAY, PENDING, inside window, with customerEmail
    const eligibleOrder = await createTestOrder({
      userId: user.id,
      items: [{ variantId: variant.id, productId: product.id, qty: 1, unitPrice: 100000 }],
      status: "PENDING",
      paymentMethod: "RAZORPAY",
      createdAt: insideWindow,
    });

    // 2. COD order in same window: must NEVER receive abandoned cart email
    const codOrder = await createTestOrder({
      userId: user.id,
      items: [{ variantId: variant.id, productId: product.id, qty: 1, unitPrice: 100000 }],
      status: "PENDING",
      paymentMethod: "COD",
      createdAt: insideWindow,
    });

    // 3. Order too old (older than 72 hours, e.g. 75 hours)
    const tooOld = new Date(Date.now() - 75 * 60 * 60 * 1000);
    const oldOrder = await createTestOrder({
      userId: user.id,
      items: [{ variantId: variant.id, productId: product.id, qty: 1, unitPrice: 100000 }],
      status: "PENDING",
      paymentMethod: "RAZORPAY",
      createdAt: tooOld,
    });

    const req1 = new Request("http://localhost/api/cron/abandoned-cart", {
      headers: { authorization: "Bearer test_cron_secret" },
    });
    const res1 = await abandonedCartHandler(req1);
    expect(res1.status).toBe(200);
    const body1 = await res1.json();
    expect(body1.emailsSent).toBe(1);

    // Eligible order has abandonedEmailSentAt set
    const checkedEligible = await prisma.order.findUnique({ where: { id: eligibleOrder.id } });
    expect(checkedEligible?.abandonedEmailSentAt).not.toBeNull();

    // COD and old orders untouched
    const checkedCod = await prisma.order.findUnique({ where: { id: codOrder.id } });
    expect(checkedCod?.abandonedEmailSentAt).toBeNull();

    const checkedOld = await prisma.order.findUnique({ where: { id: oldOrder.id } });
    expect(checkedOld?.abandonedEmailSentAt).toBeNull();

    // Second run sends nothing new (deduplicated)
    const req2 = new Request("http://localhost/api/cron/abandoned-cart", {
      headers: { authorization: "Bearer test_cron_secret" },
    });
    const res2 = await abandonedCartHandler(req2);
    expect(res2.status).toBe(200);
    const body2 = await res2.json();
    expect(body2.emailsSent).toBe(0);
  });
});
