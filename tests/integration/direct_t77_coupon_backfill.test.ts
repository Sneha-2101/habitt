import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../helpers/prisma";
import { cleanupM1TestRows, createTestCoupon } from "../helpers/fixtures";

describe("T77: Coupon to Offer Migration Backfill Verification", () => {
  const createdCouponIds: string[] = [];
  const createdOfferIds: string[] = [];

  beforeAll(async () => {
    await cleanupM1TestRows();
  });

  afterAll(async () => {
    if (createdOfferIds.length > 0) {
      await prisma.offerTarget.deleteMany({ where: { offerId: { in: createdOfferIds } } });
      await prisma.offerRedemption.deleteMany({ where: { offerId: { in: createdOfferIds } } });
      await prisma.offer.deleteMany({ where: { id: { in: createdOfferIds } } });
    }
    if (createdCouponIds.length > 0) {
      await prisma.coupon.deleteMany({ where: { id: { in: createdCouponIds } } });
    }
    await cleanupM1TestRows();
  });

  it("1. Verifies database-level equivalence: Offer count with legacyCouponId equals Coupon count", async () => {
    const couponCount = await prisma.coupon.count();
    const backfilledOffersCount = await prisma.offer.count({
      where: { legacyCouponId: { not: null } },
    });

    expect(backfilledOffersCount).toBe(couponCount);

    const couponUsageSum = await prisma.coupon.aggregate({
      _sum: { timesUsed: true },
    });
    const offerUsageSum = await prisma.offer.aggregate({
      where: { legacyCouponId: { not: null } },
      _sum: { timesUsed: true },
    });

    expect(offerUsageSum._sum.timesUsed || 0).toBe(couponUsageSum._sum.timesUsed || 0);
  });

  it("2. Verifies field-by-field mapping fidelity for coupon backfill logic", async () => {
    // Create test coupons representing different scenarios
    const c1 = await createTestCoupon({
      discountType: "PERCENT",
      value: 15,
      usageLimit: 50,
      timesUsed: 5,
    });
    createdCouponIds.push(c1.id);

    const c2 = await createTestCoupon({
      discountType: "FLAT",
      value: 20000,
      usageLimit: null,
      timesUsed: 0,
    });
    createdCouponIds.push(c2.id);

    // Run the backfill INSERT SQL statement on these coupons
    await prisma.$executeRaw`
      INSERT INTO "Offer" (
          "id", "name", "kind", "code", "active", "startsAt", "endsAt",
          "minCartPaise", "maxUsesTotal", "maxUsesPerCustomer", "timesUsed",
          "priority", "audience", "config", "legacyCouponId", "createdAt", "updatedAt"
      )
      SELECT
          'off_' || c."id",
          'Coupon ' || UPPER(c."code"),
          CASE c."discountType"::text
              WHEN 'PERCENT' THEN 'PERCENT_OFF'::"OfferKind"
              WHEN 'FLAT' THEN 'FLAT_OFF'::"OfferKind"
          END,
          UPPER(c."code"),
          CASE
              WHEN (c."expiresAt" IS NULL OR c."expiresAt" > CURRENT_TIMESTAMP)
               AND (c."usageLimit" IS NULL OR c."timesUsed" < c."usageLimit")
              THEN true
              ELSE false
          END,
          c."createdAt",
          c."expiresAt",
          0,
          c."usageLimit",
          NULL,
          c."timesUsed",
          100,
          CASE
              WHEN UPPER(c."code") LIKE 'WELCOME%' THEN 'FIRST_ORDER'::"OfferAudience"
              WHEN UPPER(c."code") LIKE 'BDAY%' THEN 'BIRTHDAY'::"OfferAudience"
              ELSE 'ALL'::"OfferAudience"
          END,
          CASE c."discountType"::text
              WHEN 'PERCENT' THEN jsonb_build_object('percent', c."value")
              WHEN 'FLAT' THEN jsonb_build_object('amountPaise', c."value")
          END,
          c."id",
          c."createdAt",
          CURRENT_TIMESTAMP
      FROM "Coupon" c
      WHERE c."id" IN (${c1.id}, ${c2.id})
      ON CONFLICT ("legacyCouponId") DO NOTHING;
    `;

    const offer1 = await prisma.offer.findUnique({
      where: { legacyCouponId: c1.id },
    });
    expect(offer1).not.toBeNull();
    if (offer1) {
      createdOfferIds.push(offer1.id);
      expect(offer1.code).toBe(c1.code.toUpperCase());
      expect(offer1.kind).toBe("PERCENT_OFF");
      expect(offer1.config).toEqual({ percent: 15 });
      expect(offer1.maxUsesTotal).toBe(50);
      expect(offer1.timesUsed).toBe(5);
      expect(offer1.active).toBe(true);
      expect(offer1.audience).toBe("ALL");
    }

    const offer2 = await prisma.offer.findUnique({
      where: { legacyCouponId: c2.id },
    });
    expect(offer2).not.toBeNull();
    if (offer2) {
      createdOfferIds.push(offer2.id);
      expect(offer2.code).toBe(c2.code.toUpperCase());
      expect(offer2.kind).toBe("FLAT_OFF");
      expect(offer2.config).toEqual({ amountPaise: 20000 });
      expect(offer2.maxUsesTotal).toBeNull();
      expect(offer2.timesUsed).toBe(0);
      expect(offer2.active).toBe(true);
    }
  });
});
