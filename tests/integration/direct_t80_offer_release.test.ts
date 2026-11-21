import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { prisma } from "../helpers/prisma";
import {
  createTestUser,
  createTestProduct,
  createTestOrder,
  cleanupM1TestRows,
  genId,
} from "../helpers/fixtures";
import { releaseOfferUsage } from "@/lib/offers/release";
import { SiteSettings } from "@prisma/client";

describe("T80: Offer Usage Release and Concurrency Integrity", () => {
  let originalSettings: SiteSettings | null = null;
  const createdOfferIds: string[] = [];

  beforeAll(async () => {
    originalSettings = await prisma.siteSettings.findFirst();
    if (originalSettings) {
      await prisma.siteSettings.update({
        where: { id: originalSettings.id },
        data: {
          codEnabled: true,
          freeShippingOnPrepaid: true,
          shippingFee: 9900,
          freeShippingThreshold: 299900,
        },
      });
    }
  });

  afterAll(async () => {
    if (originalSettings) {
      const { id, ...data } = originalSettings;
      await prisma.siteSettings.update({
        where: { id },
        data,
      });
    }
    if (createdOfferIds.length > 0) {
      await prisma.offerTarget.deleteMany({ where: { offerId: { in: createdOfferIds } } });
      await prisma.offerRedemption.deleteMany({ where: { offerId: { in: createdOfferIds } } });
      await prisma.offer.deleteMany({ where: { id: { in: createdOfferIds } } });
    }
    await cleanupM1TestRows();
  });

  beforeEach(async () => {
    await cleanupM1TestRows();
  });

  afterEach(async () => {
    if (createdOfferIds.length > 0) {
      await prisma.offerTarget.deleteMany({ where: { offerId: { in: createdOfferIds } } });
      await prisma.offerRedemption.deleteMany({ where: { offerId: { in: createdOfferIds } } });
      await prisma.offer.deleteMany({ where: { id: { in: createdOfferIds } } });
      createdOfferIds.length = 0;
    }
    await cleanupM1TestRows();
  });

  it("1. Cancel an order that used an automatic offer with maxUsesTotal 1: timesUsed back to 0 and a second order can use it", async () => {
    const user1 = await createTestUser();
    const user2 = await createTestUser();
    const { product, variants } = await createTestProduct({ price: 100000, variants: [{ size: "M", stock: 10 }] });

    const offerId = genId("m1test_off");
    createdOfferIds.push(offerId);

    // Automatic offer with maxUsesTotal = 1
    await prisma.offer.create({
      data: {
        id: offerId,
        name: "Single-Use Auto Offer",
        kind: "PERCENT_OFF",
        active: true,
        priority: 10,
        audience: "ALL",
        maxUsesTotal: 1,
        timesUsed: 1, // Simulated as used by order1
        config: { percent: 10 },
      },
    });

    // Create Order 1 for User 1 with redemption attached
    const order1 = await createTestOrder({
      userId: user1.id,
      items: [{ variantId: variants[0].id, productId: product.id, qty: 1, unitPrice: 100000 }],
      status: "PENDING",
      paymentMethod: "RAZORPAY",
      stockDeducted: false,
    });

    await prisma.offerRedemption.create({
      data: {
        offerId,
        orderId: order1.id,
        userId: user1.id,
        amountPaise: 10000,
      },
    });

    // Cancel order 1 via releaseOfferUsage inside transaction (or cancelOrderAsCustomer)
    await prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: order1.id },
        data: { fulfilmentStatus: "CANCELLED" },
      });
      await releaseOfferUsage(tx, order1.id);
    });

    // Check timesUsed is back to 0
    const offerAfterCancel = await prisma.offer.findUnique({ where: { id: offerId } });
    expect(offerAfterCancel?.timesUsed).toBe(0);

    // Offer can now be claimed by second order
    const claimResult = await prisma.$transaction(async (tx) => {
      const count = await tx.$executeRaw`
        UPDATE "Offer"
        SET "timesUsed" = "timesUsed" + 1
        WHERE "id" = ${offerId}
          AND "active" = true
          AND ("maxUsesTotal" IS NULL OR "timesUsed" < "maxUsesTotal")
      `;
      if (count === 1) {
        const order2 = await createTestOrder({
          userId: user2.id,
          items: [{ variantId: variants[0].id, productId: product.id, qty: 1, unitPrice: 100000 }],
          status: "PENDING",
          paymentMethod: "RAZORPAY",
        });
        await tx.offerRedemption.create({
          data: {
            offerId,
            orderId: order2.id,
            userId: user2.id,
            amountPaise: 10000,
          },
        });
        return { success: true, orderId: order2.id };
      }
      return { success: false };
    });

    expect(claimResult.success).toBe(true);

    const offerAfterOrder2 = await prisma.offer.findUnique({ where: { id: offerId } });
    expect(offerAfterOrder2?.timesUsed).toBe(1);
  });

  it("2. Double-cancel does not go below 0 (idempotent)", async () => {
    const user = await createTestUser();
    const { product, variants } = await createTestProduct({ price: 100000, variants: [{ size: "M", stock: 10 }] });

    const offerId = genId("m1test_off");
    createdOfferIds.push(offerId);

    await prisma.offer.create({
      data: {
        id: offerId,
        name: "Double Cancel Test Offer",
        kind: "PERCENT_OFF",
        active: true,
        priority: 10,
        audience: "ALL",
        maxUsesTotal: 1,
        timesUsed: 1,
        config: { percent: 10 },
      },
    });

    const order = await createTestOrder({
      userId: user.id,
      items: [{ variantId: variants[0].id, productId: product.id, qty: 1, unitPrice: 100000 }],
      status: "PENDING",
      paymentMethod: "RAZORPAY",
      stockDeducted: false,
    });

    await prisma.offerRedemption.create({
      data: {
        offerId,
        orderId: order.id,
        userId: user.id,
        amountPaise: 10000,
      },
    });

    // First release
    await prisma.$transaction(async (tx) => {
      await releaseOfferUsage(tx, order.id);
    });

    const offerAfterFirst = await prisma.offer.findUnique({ where: { id: offerId } });
    expect(offerAfterFirst?.timesUsed).toBe(0);

    // Second release (simulating double cancel or retry)
    await prisma.$transaction(async (tx) => {
      await releaseOfferUsage(tx, order.id);
    });

    const offerAfterSecond = await prisma.offer.findUnique({ where: { id: offerId } });
    expect(offerAfterSecond?.timesUsed).toBe(0); // MUST NEVER GO BELOW 0
  });

  it("3. Concurrency race: 2 parallel claims on maxUsesTotal 1 yields exactly one winner", async () => {
    const offerId = genId("m1test_off");
    createdOfferIds.push(offerId);

    await prisma.offer.create({
      data: {
        id: offerId,
        name: "Race Test Offer",
        kind: "PERCENT_OFF",
        active: true,
        priority: 10,
        audience: "ALL",
        maxUsesTotal: 1,
        timesUsed: 0,
        config: { percent: 10 },
      },
    });

    // Run 2 parallel transactions trying to claim the offer atomically
    const claim = async (claimant: string) => {
      return prisma.$transaction(async (tx) => {
        const count = await tx.$executeRaw`
          UPDATE "Offer"
          SET "timesUsed" = "timesUsed" + 1
          WHERE "id" = ${offerId}
            AND "active" = true
            AND ("maxUsesTotal" IS NULL OR "timesUsed" < "maxUsesTotal")
        `;
        return { claimant, won: count === 1 };
      });
    };

    const results = await Promise.all([claim("buyer-1"), claim("buyer-2")]);
    const winners = results.filter((r) => r.won);
    const losers = results.filter((r) => !r.won);

    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);

    const finalOffer = await prisma.offer.findUnique({ where: { id: offerId } });
    expect(finalOffer?.timesUsed).toBe(1);
  });
});
