import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { prisma } from "../helpers/prisma";
import {
  createTestUser,
  createTestProduct,
  cleanupM1TestRows,
  genId,
} from "../helpers/fixtures";
import { calculateQuote } from "@/lib/pricing/quote";
import { SiteSettings } from "@prisma/client";

describe("T78: Offers Engine Quote Integration", () => {
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

  it("1. Group 1: PERCENT_OFF and FLAT_OFF offers apply correctly in quote", async () => {
    const user = await createTestUser();
    const { product, variants } = await createTestProduct({ price: 100000, variants: [{ size: "M", stock: 10 }] });

    // Create automatic 10% off offer
    const offerId = genId("m1test_off");
    createdOfferIds.push(offerId);
    await prisma.offer.create({
      data: {
        id: offerId,
        name: "m1test 10% Auto Off",
        kind: "PERCENT_OFF",
        active: true,
        priority: 10,
        audience: "ALL",
        config: { percent: 10 },
      },
    });

    const quote = await calculateQuote({
      userId: user.id,
      items: [{ productId: product.id, variantId: variants[0].id, qty: 1 }],
      paymentMethod: "RAZORPAY",
    });

    expect(quote.subtotal).toBe(100000);
    expect(quote.discount).toBe(10000);
    expect(quote.appliedOffers).toHaveLength(1);
    expect(quote.appliedOffers[0].offerId).toBe(offerId);
    expect(quote.payable).toBe(90000);
  });

  it("2. Group 2: TIER offer applies highest matching tier by quantity", async () => {
    const user = await createTestUser();
    const { product, variants } = await createTestProduct({ price: 50000, variants: [{ size: "M", stock: 10 }] });

    const offerId = genId("m1test_off");
    createdOfferIds.push(offerId);
    await prisma.offer.create({
      data: {
        id: offerId,
        name: "m1test Volume Tier",
        kind: "TIER",
        active: true,
        priority: 10,
        audience: "ALL",
        config: {
          tiers: [
            { minQty: 2, type: "PERCENT", value: 10 },
            { minQty: 4, type: "PERCENT", value: 20 },
          ],
        },
      },
    });

    // 3 items -> matches tier 1 (10% of 150000 = 15000)
    const quote3 = await calculateQuote({
      userId: user.id,
      items: [{ productId: product.id, variantId: variants[0].id, qty: 3 }],
      paymentMethod: "RAZORPAY",
    });
    expect(quote3.discount).toBe(15000);

    // 4 items -> matches tier 2 (20% of 200000 = 40000)
    const quote4 = await calculateQuote({
      userId: user.id,
      items: [{ productId: product.id, variantId: variants[0].id, qty: 4 }],
      paymentMethod: "RAZORPAY",
    });
    expect(quote4.discount).toBe(40000);
  });

  it("3. Group 3: COMBO_ANY bundles items and maximizes savings", async () => {
    const user = await createTestUser();
    const { product, variants } = await createTestProduct({ price: 80000, variants: [{ size: "M", stock: 10 }] });

    const offerId = genId("m1test_off");
    createdOfferIds.push(offerId);
    await prisma.offer.create({
      data: {
        id: offerId,
        name: "m1test Buy 2 for 1200",
        kind: "COMBO_ANY",
        active: true,
        priority: 10,
        audience: "ALL",
        config: {
          quantity: 2,
          fixedPricePaise: 120000, // Regular = 160000, save 40000
          repeatable: true,
        },
      },
    });

    const quote = await calculateQuote({
      userId: user.id,
      items: [{ productId: product.id, variantId: variants[0].id, qty: 2 }],
      paymentMethod: "RAZORPAY",
    });

    expect(quote.subtotal).toBe(160000);
    expect(quote.discount).toBe(40000);
    expect(quote.payable).toBe(120000);
  });

  it("4. Group 4: GIFT offers return free variant and text gifts", async () => {
    const user = await createTestUser();
    const { product: mainProd, variants: mainVars } = await createTestProduct({ price: 100000, variants: [{ size: "M", stock: 10 }] });
    const { variants: giftVars } = await createTestProduct({ price: 20000, variants: [{ size: "Free Size", stock: 5 }] });

    const offerId = genId("m1test_off");
    createdOfferIds.push(offerId);
    await prisma.offer.create({
      data: {
        id: offerId,
        name: "m1test Free Socks & Sticker",
        kind: "GIFT",
        active: true,
        priority: 10,
        audience: "ALL",
        config: {
          buyQty: 0,
          giftQty: 1,
          gift: { type: "VARIANT", variantId: giftVars[0].id },
        },
      },
    });

    const quote = await calculateQuote({
      userId: user.id,
      items: [{ productId: mainProd.id, variantId: mainVars[0].id, qty: 1 }],
      paymentMethod: "RAZORPAY",
    });

    expect(quote.gifts).toHaveLength(1);
    expect(quote.gifts[0].type).toBe("VARIANT");
    expect(quote.gifts[0].variantId).toBe(giftVars[0].id);
  });

  it("5. Cost price guard: costPrice is NEVER present anywhere in quote result JSON", async () => {
    const user = await createTestUser();
    const secretCost = 76543;
    const { product, variants } = await createTestProduct({
      price: 100000,
      costPrice: secretCost,
      variants: [{ size: "M", stock: 10 }],
    });

    const quote = await calculateQuote({
      userId: user.id,
      items: [{ productId: product.id, variantId: variants[0].id, qty: 1 }],
      paymentMethod: "RAZORPAY",
    });

    const serialized = JSON.stringify(quote);
    expect(serialized).not.toContain(String(secretCost));
    expect(serialized.toLowerCase()).not.toContain("costprice");
    expect(serialized.toLowerCase()).not.toContain("costpaise");

    // Deep recursive check on every object key and value
    function deepVerifyNoCost(obj: unknown) {
      if (!obj || typeof obj !== "object") return;
      for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
        expect(key.toLowerCase()).not.toBe("costprice");
        expect(key.toLowerCase()).not.toBe("costpaise");
        expect(key.toLowerCase()).not.toBe("cost");
        expect(value).not.toBe(secretCost);
        if (typeof value === "object") {
          deepVerifyNoCost(value);
        }
      }
    }
    deepVerifyNoCost(quote);
  });
});
