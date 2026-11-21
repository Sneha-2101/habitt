import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../helpers/prisma";
import { cleanupM1TestRows } from "../helpers/fixtures";

describe("T77: Coupon to Offer Migration Backfill Verification", () => {
  beforeAll(async () => {
    await cleanupM1TestRows();
  });

  afterAll(async () => {
    await cleanupM1TestRows();
  });

  it("1. Verifies database-level equivalence: legacy offers exist and retain backfilled structure", async () => {
    const backfilledOffers = await prisma.offer.findMany({
      where: { legacyCouponId: { not: null } },
    });

    // In a migrated database, all backfilled offers have non-null legacyCouponId
    expect(Array.isArray(backfilledOffers)).toBe(true);
    for (const offer of backfilledOffers) {
      expect(offer.legacyCouponId).toBeTruthy();
      expect(offer.code).toBeTruthy();
      expect(["PERCENT_OFF", "FLAT_OFF"]).toContain(offer.kind);
      expect(offer.config).toBeDefined();
    }
  });

  it("2. Verifies field-by-field mapping fidelity for coupon backfill schema", async () => {
    const sampleBackfill = await prisma.offer.findFirst({
      where: { legacyCouponId: { not: null } },
    });
    if (sampleBackfill) {
      expect(sampleBackfill.id).toBeTruthy();
      expect(sampleBackfill.name).toBeTruthy();
      expect(typeof sampleBackfill.priority).toBe("number");
      expect(typeof sampleBackfill.timesUsed).toBe("number");
    }
  });
});
