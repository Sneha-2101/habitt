import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { prisma } from "../helpers/prisma";
import { createTestUser, createTestProduct, createTestOrder, cleanupM1TestRows } from "../helpers/fixtures";
import { isEligibleForCod } from "@/lib/actions/cod-eligibility";
import { SiteSettings } from "@prisma/client";

describe("T28: COD Toggle and Eligibility Rules", () => {
  let originalSettings: SiteSettings | null = null;

  beforeAll(async () => {
    originalSettings = await prisma.siteSettings.findFirst();
  });

  afterAll(async () => {
    if (originalSettings) {
      const { id, ...data } = originalSettings;
      await prisma.siteSettings.update({
        where: { id },
        data,
      });
    }
  });

  beforeEach(async () => {
    await cleanupM1TestRows();
  });

  afterEach(async () => {
    await cleanupM1TestRows();
  });

  it("blocks first-time customer when codRequiresDeliveredOrder is true", async () => {
    const settings = await prisma.siteSettings.findFirst();
    if (settings) {
      await prisma.siteSettings.update({
        where: { id: settings.id },
        data: {
          codEnabled: true,
          codOrderCap: 500000,
          codRequiresDeliveredOrder: true,
        },
      });
    }

    const user = await createTestUser();
    const res = await isEligibleForCod(user.id, 100000);

    expect(res.eligible).toBe(false);
    expect(res.reason).toBe("COD available on orders after your first delivered order");
    expect(res.message).toBe("COD available on orders after your first delivered order");
  });

  it("allows first-time customer when codRequiresDeliveredOrder is false within cap", async () => {
    const settings = await prisma.siteSettings.findFirst();
    if (settings) {
      await prisma.siteSettings.update({
        where: { id: settings.id },
        data: {
          codEnabled: true,
          codOrderCap: 500000,
          codRequiresDeliveredOrder: false,
        },
      });
    }

    const user = await createTestUser();
    const res = await isEligibleForCod(user.id, 100000);

    expect(res.eligible).toBe(true);
    expect(res.reason).toBeUndefined();
  });

  it("allows returning customer with delivered order even when codRequiresDeliveredOrder is true", async () => {
    const settings = await prisma.siteSettings.findFirst();
    if (settings) {
      await prisma.siteSettings.update({
        where: { id: settings.id },
        data: {
          codEnabled: true,
          codOrderCap: 500000,
          codRequiresDeliveredOrder: true,
        },
      });
    }

    const user = await createTestUser();
    const { product, variants } = await createTestProduct({ price: 100000 });
    await createTestOrder({
      userId: user.id,
      items: [{ productId: product.id, variantId: variants[0].id, qty: 1, unitPrice: 100000 }],
      status: "DELIVERED",
    });

    const res = await isEligibleForCod(user.id, 100000);
    expect(res.eligible).toBe(true);
  });
});

