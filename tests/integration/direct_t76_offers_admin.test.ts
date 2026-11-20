import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from "vitest";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { prisma } from "../helpers/prisma";
import * as guardsModule from "@/lib/guards";
import { type GuardUser, ForbiddenError } from "@/lib/guards";
import {
  createOffer,
  updateOffer,
  setOfferActive,
  deleteOffer,
} from "@/lib/actions/offers";
import {
  createTestUser,
  createTestProduct,
  createTestOrder,
  cleanupM1TestRows,
  genId,
} from "../helpers/fixtures";

describe("T76: Offers Foundation, Validation, and Admin Actions", () => {
  const createdOfferIds: string[] = [];
  const createdProductIds: string[] = [];
  const createdOrderIds: string[] = [];
  const testUserIds: string[] = [];

  let staffUser: GuardUser;
  let sampleProductId: string;
  let sampleVariantId: string;
  let zeroStockVariantId: string;
  let sampleCategoryId: string;

  beforeAll(async () => {
    await cleanupM1TestRows();

    // Staff user
    const staff = await createTestUser({
      email: `${genId("m1test_staff")}@habitt.test`,
      role: "STAFF",
    });
    testUserIds.push(staff.id);
    staffUser = {
      id: staff.id,
      email: staff.email,
      name: staff.name,
      role: "STAFF",
    };

    // Category
    const cat = await prisma.category.findFirst();
    if (!cat) throw new Error("No category found in database");
    sampleCategoryId = cat.id;

    // Test product with in-stock and 0-stock variants
    const { product, variants } = await createTestProduct({
      variants: [
        { size: "M", color: "Black", stock: 10, sku: `m1test-sku-${Date.now()}-1` },
        { size: "L", color: "Black", stock: 0, sku: `m1test-sku-${Date.now()}-2` },
      ],
    });
    createdProductIds.push(product.id);
    sampleProductId = product.id;
    sampleVariantId = variants[0].id;
    zeroStockVariantId = variants[1].id;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    // Delete order redemptions and discounts
    if (createdOrderIds.length > 0) {
      await prisma.orderDiscount.deleteMany({ where: { orderId: { in: createdOrderIds } } });
      await prisma.offerRedemption.deleteMany({ where: { orderId: { in: createdOrderIds } } });
      await prisma.orderItem.deleteMany({ where: { orderId: { in: createdOrderIds } } });
      await prisma.orderStatusEvent.deleteMany({ where: { orderId: { in: createdOrderIds } } });
      await prisma.order.deleteMany({ where: { id: { in: createdOrderIds } } });
    }
    // Delete offer targets and offers
    if (createdOfferIds.length > 0) {
      await prisma.offerTarget.deleteMany({ where: { offerId: { in: createdOfferIds } } });
      await prisma.offerRedemption.deleteMany({ where: { offerId: { in: createdOfferIds } } });
      await prisma.offer.deleteMany({ where: { id: { in: createdOfferIds } } });
    }
    if (createdProductIds.length > 0) {
      await prisma.productVariant.deleteMany({ where: { productId: { in: createdProductIds } } });
      await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
    }
    if (testUserIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: testUserIds } } });
    }
    await cleanupM1TestRows();
  });

  function mockStaff() {
    vi.spyOn(guardsModule, "requireStaff").mockResolvedValue(staffUser);
  }

  function mockCustomer() {
    vi.spyOn(guardsModule, "requireStaff").mockRejectedValue(new ForbiddenError());
  }

  it("1. Non-staff is rejected on offer creation", async () => {
    mockCustomer();
    await expect(
      createOffer({
        name: "m1test Unauth Offer",
        kind: "PERCENT_OFF",
        config: { percent: 10 },
      })
    ).rejects.toThrow();
  });

  it("2. Creates one offer of each of the groups: percent, flat, tier, combo any, combo slots, gift variant, gift text", async () => {
    mockStaff();

    // Group 1a: PERCENT_OFF
    const resPercent = await createOffer({
      name: "m1test Percent Offer",
      kind: "PERCENT_OFF",
      code: "m1test_pct20",
      active: true,
      minCartRupees: 500,
      config: { percent: 20 },
      targets: [{ type: "product", id: sampleProductId }],
    });
    expect(resPercent.success).toBe(true);
    expect(resPercent.offer.code).toBe("M1TEST_PCT20");
    createdOfferIds.push(resPercent.offer.id);

    // Group 1b: FLAT_OFF
    const resFlat = await createOffer({
      name: "m1test Flat Offer",
      kind: "FLAT_OFF",
      active: true,
      config: { amountRupees: 150 },
      targets: [{ type: "category", id: sampleCategoryId }],
    });
    expect(resFlat.success).toBe(true);
    expect(resFlat.offer.config).toEqual({ amountPaise: 15000 });
    createdOfferIds.push(resFlat.offer.id);

    const toggleRes = await setOfferActive(resFlat.offer.id, false);
    expect(toggleRes.success).toBe(true);
    expect(toggleRes.offer.active).toBe(false);

    // Group 2: TIER
    const resTier = await createOffer({
      name: "m1test Tier Offer",
      kind: "TIER",
      active: true,
      config: {
        tiers: [
          { minQty: 2, type: "PERCENT", value: 10 },
          { minQty: 3, type: "FLAT_PER_UNIT", valueRupees: 100 },
        ],
      },
    });
    expect(resTier.success).toBe(true);
    createdOfferIds.push(resTier.offer.id);

    // Group 3a: COMBO_ANY
    const resComboAny = await createOffer({
      name: "m1test Combo Any Offer",
      kind: "COMBO_ANY",
      active: true,
      config: {
        quantity: 3,
        fixedPriceRupees: 1999,
        repeatable: true,
      },
      targets: [{ type: "category", id: sampleCategoryId }],
    });
    expect(resComboAny.success).toBe(true);
    expect(resComboAny.offer.config).toEqual({
      quantity: 3,
      fixedPricePaise: 199900,
      repeatable: true,
    });
    createdOfferIds.push(resComboAny.offer.id);

    // Group 3b: COMBO_SLOTS
    const resComboSlots = await createOffer({
      name: "m1test Combo Slots Offer",
      kind: "COMBO_SLOTS",
      active: true,
      config: {
        slots: [
          {
            label: "Slot Top",
            quantity: 1,
            selector: { type: "category", id: sampleCategoryId },
          },
          {
            label: "Slot Bottom",
            quantity: 1,
            selector: { type: "product", id: sampleProductId },
          },
        ],
        fixedPriceRupees: 2499,
        repeatable: true,
      },
    });
    expect(resComboSlots.success).toBe(true);
    createdOfferIds.push(resComboSlots.offer.id);

    // Group 4a: GIFT (variant in-stock)
    const resGiftVar = await createOffer({
      name: "m1test Gift Variant Offer",
      kind: "GIFT",
      active: true,
      config: {
        buyQty: 2,
        giftQty: 1,
        gift: { type: "VARIANT", variantId: sampleVariantId },
      },
    });
    expect(resGiftVar.success).toBe(true);
    expect(resGiftVar.warning).toBeUndefined();
    createdOfferIds.push(resGiftVar.offer.id);

    // Group 4b: GIFT (variant with 0 stock saves with warning)
    const resGiftZeroStock = await createOffer({
      name: "m1test Gift Zero Stock Offer",
      kind: "GIFT",
      active: true,
      config: {
        buyQty: 2,
        giftQty: 1,
        gift: { type: "VARIANT", variantId: zeroStockVariantId },
      },
    });
    expect(resGiftZeroStock.success).toBe(true);
    expect(resGiftZeroStock.warning).toMatch(/0 stock/i);
    createdOfferIds.push(resGiftZeroStock.offer.id);

    // Group 4c: GIFT (text description)
    const resGiftText = await createOffer({
      name: "m1test Gift Text Offer",
      kind: "GIFT",
      active: true,
      config: {
        buyQty: 0,
        giftQty: 1,
        gift: { type: "TEXT", text: "Free Minimalist Linen Tote" },
      },
      minCartRupees: 2999,
    });
    expect(resGiftText.success).toBe(true);
    createdOfferIds.push(resGiftText.offer.id);
  });

  it("3. Duplicate coupon code is rejected case-insensitively with friendly error", async () => {
    mockStaff();
    const code = `m1test_dup_${Date.now()}`.toUpperCase();

    const o1 = await createOffer({
      name: "m1test First Offer",
      kind: "PERCENT_OFF",
      code: code.toLowerCase(),
      config: { percent: 10 },
    });
    createdOfferIds.push(o1.offer.id);

    // Second offer with uppercase or mixed-case of same code
    await expect(
      createOffer({
        name: "m1test Second Offer",
        kind: "PERCENT_OFF",
        code: code.toUpperCase(),
        config: { percent: 15 },
      })
    ).rejects.toThrow(/already in use|duplicate/i);
  });

  it("4. SQL CHECK rejects an OfferTarget with 2 or 0 non-null targets on raw insert", async () => {
    mockStaff();
    const offer = await createOffer({
      name: "m1test Target Constraint Check",
      kind: "PERCENT_OFF",
      config: { percent: 10 },
    });
    createdOfferIds.push(offer.offer.id);

    // Raw insert with 0 non-null targets (all null) -> violates CHECK num_nonnulls = 1
    await expect(
      prisma.$executeRaw`
        INSERT INTO "OfferTarget" ("id", "offerId", "categoryId", "productId", "collectionId")
        VALUES (${genId("m1test_tgt")}, ${offer.offer.id}, NULL, NULL, NULL)
      `
    ).rejects.toThrow();

    // Raw insert with 2 non-null targets (both categoryId and productId) -> violates CHECK num_nonnulls = 1
    await expect(
      prisma.$executeRaw`
        INSERT INTO "OfferTarget" ("id", "offerId", "categoryId", "productId", "collectionId")
        VALUES (${genId("m1test_tgt")}, ${offer.offer.id}, ${sampleCategoryId}, ${sampleProductId}, NULL)
      `
    ).rejects.toThrow();
  });

  it("5. AuditLog rows are written on offer creation, update, and deletion", async () => {
    mockStaff();
    const res = await createOffer({
      name: "m1test Audited Offer",
      kind: "PERCENT_OFF",
      config: { percent: 25 },
    });
    const offerId = res.offer.id;
    createdOfferIds.push(offerId);

    // Verify create audit log
    const createLog = await prisma.auditLog.findFirst({
      where: {
        action: "offer.create",
        entityId: offerId,
      },
    });
    expect(createLog).not.toBeNull();
    expect(createLog?.actorId).toBe(staffUser.id);

    // Update offer
    await updateOffer(offerId, {
      name: "m1test Audited Offer Updated",
      kind: "PERCENT_OFF",
      config: { percent: 30 },
    });

    const updateLog = await prisma.auditLog.findFirst({
      where: {
        action: "offer.update",
        entityId: offerId,
      },
    });
    expect(updateLog).not.toBeNull();

    // Delete offer
    await deleteOffer(offerId);
    const deleteLog = await prisma.auditLog.findFirst({
      where: {
        action: "offer.delete",
        entityId: offerId,
      },
    });
    expect(deleteLog).not.toBeNull();
  });

  it("6. Refuses deleteOffer when an OfferRedemption row exists", async () => {
    mockStaff();
    const offerRes = await createOffer({
      name: "m1test Redeemed Offer",
      kind: "PERCENT_OFF",
      code: `m1test_red_${Date.now()}`.toUpperCase(),
      config: { percent: 10 },
    });
    const offerId = offerRes.offer.id;
    createdOfferIds.push(offerId);

    // Create an order and redemption
    const cust = await createTestUser({ email: `${genId("m1test_cust")}@habitt.test` });
    testUserIds.push(cust.id);

    const order = await createTestOrder({
      userId: cust.id,
      items: [{ productId: sampleProductId, variantId: sampleVariantId, qty: 1, unitPrice: 1000 }],
    });
    createdOrderIds.push(order.id);

    // Create redemption
    const redemption = await prisma.offerRedemption.create({
      data: {
        id: genId("m1test_red"),
        offerId,
        orderId: order.id,
        userId: cust.id,
        amountPaise: 100,
      },
    });

    // deleteOffer must throw
    await expect(deleteOffer(offerId)).rejects.toThrow(
      /Cannot delete offer because it has customer redemptions recorded/i
    );

    // Clean up redemption
    await prisma.offerRedemption.delete({ where: { id: redemption.id } });
  });
});
