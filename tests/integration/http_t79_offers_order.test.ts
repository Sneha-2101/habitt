import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import crypto from "crypto";
import { prisma } from "../helpers/prisma";
import {
  createTestUser,
  createTestProduct,
  cleanupM1TestRows,
  genId,
} from "../helpers/fixtures";
import { createSessionCookie } from "../helpers/session";
import { subscribeNewsletter } from "@/lib/actions/newsletter";
import { resetMemoryLimits } from "@/lib/ratelimit";
import { markOrderPaid } from "@/lib/orders/mark-paid";
import { SiteSettings } from "@prisma/client";

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3000";

describe("T79: Offers Order Placement & Concurrency", () => {
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
    resetMemoryLimits();
    await cleanupM1TestRows();
  });

  afterEach(async () => {
    resetMemoryLimits();
    if (createdOfferIds.length > 0) {
      await prisma.offerTarget.deleteMany({ where: { offerId: { in: createdOfferIds } } });
      await prisma.offerRedemption.deleteMany({ where: { offerId: { in: createdOfferIds } } });
      await prisma.offer.deleteMany({ where: { id: { in: createdOfferIds } } });
      createdOfferIds.length = 0;
    }
    await cleanupM1TestRows();
  });

  it("1. Usage-limit race test: 2 parallel orders on maxUsesTotal 1: exactly 1 succeeds", async () => {
    const user1 = await createTestUser();
    const session1 = await createSessionCookie(user1.id);
    const user2 = await createTestUser();
    const session2 = await createSessionCookie(user2.id);

    const { product, variants } = await createTestProduct({ price: 100000, variants: [{ size: "M", stock: 10 }] });
    const variant = variants[0];

    // Single-use coupon offer
    const offerId = genId("m1test_off");
    const offerCode = `M1TEST_RACE_${crypto.randomBytes(3).toString("hex")}`.toUpperCase();
    createdOfferIds.push(offerId);

    await prisma.offer.create({
      data: {
        id: offerId,
        name: "Race Offer",
        kind: "PERCENT_OFF",
        code: offerCode,
        active: true,
        priority: 100,
        audience: "ALL",
        maxUsesTotal: 1,
        timesUsed: 0,
        config: { percent: 15 },
      },
    });

    const [res1, res2] = await Promise.all([
      fetch(`${BASE_URL}/api/checkout/create-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: session1.headerValue },
        body: JSON.stringify({
          idempotencyKey: crypto.randomUUID(),
          items: [{ productId: product.id, variantId: variant.id, qty: 1 }],
          customerName: "User 1",
          customerPhone: "9876543210",
          shippingAddress: { line1: "Street 1", city: "Mumbai", state: "MH", pincode: "400001" },
          paymentMethod: "RAZORPAY",
          couponCode: offerCode,
        }),
      }),
      fetch(`${BASE_URL}/api/checkout/create-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: session2.headerValue },
        body: JSON.stringify({
          idempotencyKey: crypto.randomUUID(),
          items: [{ productId: product.id, variantId: variant.id, qty: 1 }],
          customerName: "User 2",
          customerPhone: "9876543211",
          shippingAddress: { line1: "Street 2", city: "Mumbai", state: "MH", pincode: "400001" },
          paymentMethod: "RAZORPAY",
          couponCode: offerCode,
        }),
      }),
    ]);

    const statuses = [res1.status, res2.status].sort();
    expect(statuses).toEqual([200, 409]);

    const updatedOffer = await prisma.offer.findUnique({ where: { id: offerId } });
    expect(updatedOffer?.timesUsed).toBe(1);

    const redemptions = await prisma.offerRedemption.findMany({ where: { offerId } });
    expect(redemptions).toHaveLength(1);
  });

  it("2. Stock-gift decrement & stock movement verification", async () => {
    const user = await createTestUser();
    const session = await createSessionCookie(user.id);

    // (a) COD order with a stock gift: gift variant stock 5 -> 4 immediately and a StockMovement (delta -1) exists.
    const { product: prodA, variants: varsA } = await createTestProduct({ price: 100000, variants: [{ size: "M", stock: 10 }] });
    const { variants: giftVarsA } = await createTestProduct({ price: 20000, variants: [{ size: "Free Size", stock: 5 }] });
    const giftVariantA = giftVarsA[0];

    const offerIdA = genId("m1test_off");
    createdOfferIds.push(offerIdA);
    await prisma.offer.create({
      data: {
        id: offerIdA,
        name: "Auto Gift Socks COD",
        kind: "GIFT",
        active: true,
        priority: 10,
        audience: "ALL",
        config: {
          buyQty: 0,
          giftQty: 1,
          gift: { type: "VARIANT", variantId: giftVariantA.id },
        },
      },
    });

    const resA = await fetch(`${BASE_URL}/api/checkout/create-order`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: session.headerValue },
      body: JSON.stringify({
        idempotencyKey: crypto.randomUUID(),
        items: [{ productId: prodA.id, variantId: varsA[0].id, qty: 1 }],
        customerName: "Gift User COD",
        customerPhone: "9876543210",
        shippingAddress: { line1: "Gift Street", city: "Delhi", state: "DL", pincode: "110001" },
        paymentMethod: "COD",
      }),
    });

    expect(resA.status).toBe(200);
    const dataA = await resA.json();

    // Verify gift variant stock decremented from 5 to 4 immediately
    const updatedGiftVarA = await prisma.productVariant.findUnique({ where: { id: giftVariantA.id } });
    expect(updatedGiftVarA?.stock).toBe(4);

    // Verify StockMovement record created for the gift
    const movementsA = await prisma.stockMovement.findMany({
      where: { variantId: giftVariantA.id },
    });
    expect(movementsA.length).toBeGreaterThanOrEqual(1);
    expect(movementsA.some((m) => m.delta === -1)).toBe(true);

    // Verify OrderItem created with isGift: true and unitPrice: 0
    const orderItemsA = await prisma.orderItem.findMany({
      where: { orderId: dataA.orderId },
    });
    const giftItemA = orderItemsA.find((i) => i.variantId === giftVariantA.id);
    expect(giftItemA).toBeDefined();
    expect(giftItemA?.isGift).toBe(true);
    expect(giftItemA?.unitPrice).toBe(0);

    // (b) RAZORPAY order with a stock gift: stock still 5 after create-order; after markOrderPaid, stock is 4 and a StockMovement exists.
    const { product: prodB, variants: varsB } = await createTestProduct({ price: 100000, variants: [{ size: "M", stock: 10 }] });
    const { variants: giftVarsB } = await createTestProduct({ price: 20000, variants: [{ size: "Free Size", stock: 5 }] });
    const giftVariantB = giftVarsB[0];

    const offerIdB = genId("m1test_off");
    createdOfferIds.push(offerIdB);
    await prisma.offer.create({
      data: {
        id: offerIdB,
        name: "Auto Gift Socks RAZORPAY",
        kind: "GIFT",
        active: true,
        priority: 10,
        audience: "ALL",
        config: {
          buyQty: 0,
          giftQty: 1,
          gift: { type: "VARIANT", variantId: giftVariantB.id },
        },
      },
    });

    const resB = await fetch(`${BASE_URL}/api/checkout/create-order`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: session.headerValue },
      body: JSON.stringify({
        idempotencyKey: crypto.randomUUID(),
        items: [{ productId: prodB.id, variantId: varsB[0].id, qty: 1 }],
        customerName: "Gift User RAZORPAY",
        customerPhone: "9876543210",
        shippingAddress: { line1: "Gift Street", city: "Delhi", state: "DL", pincode: "110001" },
        paymentMethod: "RAZORPAY",
      }),
    });

    expect(resB.status).toBe(200);
    const dataB = await resB.json();

    // Verify gift variant stock is STILL 5 after create-order (not decremented until payment)
    const stockBeforePayB = await prisma.productVariant.findUnique({ where: { id: giftVariantB.id } });
    expect(stockBeforePayB?.stock).toBe(5);

    // Simulate payment capture via markOrderPaid (same function used by razorpay webhook)
    await prisma.$transaction(async (tx) => {
      await markOrderPaid(tx, dataB.orderId, `pay_m1test_${crypto.randomBytes(4).toString("hex")}`);
    });

    // Verify gift variant stock is now decremented from 5 to 4
    const updatedGiftVarB = await prisma.productVariant.findUnique({ where: { id: giftVariantB.id } });
    expect(updatedGiftVarB?.stock).toBe(4);

    // Verify StockMovement record created for the gift
    const movementsB = await prisma.stockMovement.findMany({
      where: { variantId: giftVariantB.id },
    });
    expect(movementsB.length).toBeGreaterThanOrEqual(1);
    expect(movementsB.some((m) => m.delta === -1)).toBe(true);

    // Verify OrderItem created with isGift: true and unitPrice: 0
    const orderItemsB = await prisma.orderItem.findMany({
      where: { orderId: dataB.orderId },
    });
    const giftItemB = orderItemsB.find((i) => i.variantId === giftVariantB.id);
    expect(giftItemB).toBeDefined();
    expect(giftItemB?.isGift).toBe(true);
    expect(giftItemB?.unitPrice).toBe(0);
  });

  it("3. Welcome coupon flow: creates offer on subscribe and can be redeemed once", async () => {
    const subscriberEmail = `m1test_flow_${crypto.randomBytes(3).toString("hex")}@example.test`;
    await subscribeNewsletter(subscriberEmail);

    // Find the created welcome offer
    const welcomeOffer = await prisma.offer.findFirst({
      where: { audience: "FIRST_ORDER", code: { startsWith: "WELCOME-" } },
      orderBy: { createdAt: "desc" },
    });
    expect(welcomeOffer).toBeDefined();
    expect(welcomeOffer?.code).toBeTruthy();
    if (welcomeOffer) createdOfferIds.push(welcomeOffer.id);

    const user = await createTestUser();
    const session = await createSessionCookie(user.id);
    const { product, variants } = await createTestProduct({ price: 100000, variants: [{ size: "M", stock: 10 }] });

    // 1st order with welcome code succeeds
    const res1 = await fetch(`${BASE_URL}/api/checkout/create-order`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: session.headerValue },
      body: JSON.stringify({
        idempotencyKey: crypto.randomUUID(),
        items: [{ productId: product.id, variantId: variants[0].id, qty: 1 }],
        customerName: "Welcome User",
        customerPhone: "9876543210",
        shippingAddress: { line1: "Street", city: "Bengaluru", state: "KA", pincode: "560001" },
        paymentMethod: "RAZORPAY",
        couponCode: welcomeOffer?.code,
      }),
    });
    expect(res1.status).toBe(200);

    const checkedOffer = await prisma.offer.findUnique({ where: { id: welcomeOffer!.id } });
    expect(checkedOffer?.timesUsed).toBe(1);

    // 2nd order with same welcome code fails with 409
    const res2 = await fetch(`${BASE_URL}/api/checkout/create-order`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: session.headerValue },
      body: JSON.stringify({
        idempotencyKey: crypto.randomUUID(),
        items: [{ productId: product.id, variantId: variants[0].id, qty: 1 }],
        customerName: "Welcome User",
        customerPhone: "9876543210",
        shippingAddress: { line1: "Street", city: "Bengaluru", state: "KA", pincode: "560001" },
        paymentMethod: "RAZORPAY",
        couponCode: welcomeOffer?.code,
      }),
    });
    expect(res2.status).toBe(409);
  });
});
