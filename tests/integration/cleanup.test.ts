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
      orderDiscounts: await prisma.orderDiscount.count({ where: { id: { startsWith: "m1test" } } }),
      offerRedemptions: await prisma.offerRedemption.count({ where: { id: { startsWith: "m1test" } } }),
      offerTargets: await prisma.offerTarget.count({ where: { id: { startsWith: "m1test" } } }),
      productCollections: await prisma.productCollection.count({ where: { OR: [{ productId: { startsWith: "m1test" } }, { collectionId: { startsWith: "m1test" } }] } }),
      offers: await prisma.offer.count({ where: { OR: [{ id: { startsWith: "m1test" } }, { code: { startsWith: "m1test" } }, { code: { startsWith: "M1TEST" } }] } }),
      collections: await prisma.collection.count({ where: { OR: [{ id: { startsWith: "m1test" } }, { slug: { startsWith: "m1test" } }] } }),
      orders: await prisma.order.count({ where: { OR: [{ id: { startsWith: "m1test" } }, { userId: { startsWith: "m1test" } }, { displayId: { startsWith: "m1test" } }] } }),
      productVariants: await prisma.productVariant.count({ where: { OR: [{ id: { startsWith: "m1test" } }, { productId: { startsWith: "m1test" } }] } }),
      products: await prisma.product.count({ where: { OR: [{ id: { startsWith: "m1test" } }, { slug: { startsWith: "m1test" } }] } }),
      reviews: await prisma.review.count({ where: { OR: [{ id: { startsWith: "m1test" } }, { userId: { startsWith: "m1test" } }] } }),
      stockNotifications: await prisma.stockNotification.count({ where: { OR: [{ id: { startsWith: "m1test" } }, { email: { startsWith: "m1test" } }] } }),
      newsletterSubscribers: await prisma.newsletterSubscriber.count({ where: { OR: [{ id: { startsWith: "m1test" } }, { email: { startsWith: "m1test" } }] } }),
      otpCodes: await prisma.otpCode.count({ where: { OR: [{ id: { startsWith: "m1test" } }, { identifier: { startsWith: "m1test" } }] } }),
      sessions: await prisma.session.count({ where: { OR: [{ id: { startsWith: "m1test" } }, { userId: { startsWith: "m1test" } }] } }),
      auditLogs: await prisma.auditLog.count({ where: { OR: [{ id: { startsWith: "m1test" } }, { actorId: { startsWith: "m1test" } }] } }),
      staffAllowlists: await prisma.staffAllowlist.count({ where: { OR: [{ id: { startsWith: "m1test" } }, { email: { startsWith: "m1test" } }] } }),
      cartItems: await prisma.cartItem.count({ where: { OR: [{ id: { startsWith: "m1test" } }, { cart: { userId: { startsWith: "m1test" } } }] } }),
      carts: await prisma.cart.count({ where: { OR: [{ id: { startsWith: "m1test" } }, { userId: { startsWith: "m1test" } }] } }),
      addresses: await prisma.address.count({ where: { OR: [{ id: { startsWith: "m1test" } }, { userId: { startsWith: "m1test" } }] } }),
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
