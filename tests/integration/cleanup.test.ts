import { describe, it, expect } from "vitest";
import { cleanupM1TestRows } from "../helpers/fixtures";
import { prisma } from "../helpers/prisma";

describe("Final Cleanup Check", () => {
  it("cleans up and verifies 0 remaining m1test rows in every table", async () => {
    const res = await cleanupM1TestRows();
    console.log("Cleanup result:", JSON.stringify(res, null, 2));

    const checks = {
      orderStatusEvents: await prisma.orderStatusEvent.count({ where: { OR: [{ id: { startsWith: "m1test" } }, { orderId: { startsWith: "m1test" } }] } }),
      returnRequests: await prisma.returnRequest.count({ where: { OR: [{ id: { startsWith: "m1test" } }, { orderId: { startsWith: "m1test" } }] } }),
      orderItems: await prisma.orderItem.count({ where: { OR: [{ id: { startsWith: "m1test" } }, { orderId: { startsWith: "m1test" } }] } }),
      storeCreditTransactions: await prisma.storeCreditTransaction.count({ where: { OR: [{ id: { startsWith: "m1test" } }, { userId: { startsWith: "m1test" } }] } }),
      stockMovements: await prisma.stockMovement.count({ where: { OR: [{ id: { startsWith: "m1test" } }, { variantId: { startsWith: "m1test" } }] } }),
      processedWebhooks: await prisma.processedWebhook.count({ where: { id: { startsWith: "m1test" } } }),
      orders: await prisma.order.count({ where: { OR: [{ id: { startsWith: "m1test" } }, { userId: { startsWith: "m1test" } }, { displayId: { startsWith: "m1test" } }] } }),
      coupons: await prisma.coupon.count({ where: { OR: [{ id: { startsWith: "m1test" } }, { code: { startsWith: "m1test" } }] } }),
      productVariants: await prisma.productVariant.count({ where: { OR: [{ id: { startsWith: "m1test" } }, { productId: { startsWith: "m1test" } }] } }),
      products: await prisma.product.count({ where: { OR: [{ id: { startsWith: "m1test" } }, { slug: { startsWith: "m1test" } }] } }),
      reviews: await prisma.review.count({ where: { OR: [{ id: { startsWith: "m1test" } }, { userId: { startsWith: "m1test" } }] } }),
      stockNotifications: await prisma.stockNotification.count({ where: { OR: [{ id: { startsWith: "m1test" } }, { email: { startsWith: "m1test" } }] } }),
      newsletterSubscribers: await prisma.newsletterSubscriber.count({ where: { OR: [{ id: { startsWith: "m1test" } }, { email: { startsWith: "m1test" } }] } }),
      otpCodes: await prisma.otpCode.count({ where: { OR: [{ id: { startsWith: "m1test" } }, { identifier: { startsWith: "m1test" } }] } }),
      users: await prisma.user.count({ where: { OR: [{ id: { startsWith: "m1test" } }, { email: { startsWith: "m1test" } }] } }),
    };

    console.log("Direct table check counts:");
    for (const [table, count] of Object.entries(checks)) {
      console.log(`- ${table}: ${count}`);
      expect(count).toBe(0);
    }

    expect(res.remainingTotal).toBe(0);
  });
});
