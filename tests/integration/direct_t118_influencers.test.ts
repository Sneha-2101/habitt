import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { prisma } from "../helpers/prisma";
import {
  createTestUser,
  createTestProduct,
  createTestOrder,
  cleanupM1TestRows,
  genId,
} from "../helpers/fixtures";

const mockRequireRole = vi.fn();

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));
vi.mock("@/lib/guards", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/guards")>();
  return {
    ...actual,
    requireRole: (...roles: string[]) => mockRequireRole(...roles),
  };
});

import { ForbiddenError } from "@/lib/guards";
import {
  createInfluencerAction,
  updateInfluencerAction,
  setInfluencerActiveAction,
  updateInfluencerSettingsAction,
} from "@/lib/actions/influencers";
import { getInfluencerStats } from "@/lib/influencers/stats";
import { GET as exportInfluencersCsv } from "@/app/api/admin/influencers/export/route";
import { calculateQuote } from "@/lib/pricing/quote";

describe("T118: Influencers Owner Governance, Offers Sync, Stats & CSV", () => {
  let savedSettings: Awaited<ReturnType<typeof prisma.siteSettings.findUnique>> = null;

  beforeAll(async () => {
    savedSettings = await prisma.siteSettings.findUnique({ where: { id: "default" } });
  });

  afterAll(async () => {
    try {
      if (savedSettings) {
        const restoreData = { ...savedSettings } as Record<string, unknown>;
        delete restoreData.id;
        delete restoreData.updatedAt;
        await prisma.siteSettings.update({
          where: { id: "default" },
          data: restoreData,
        });
      }
    } finally {
      await cleanupM1TestRows();
    }
  });

  beforeEach(async () => {
    await cleanupM1TestRows();
  });

  afterEach(async () => {
    await cleanupM1TestRows();
  });

  it("enforces OWNER-only, syncs linked Offer, computes stats with refunds, and neutralizes CSV formulas", async () => {
    const owner = await createTestUser({ role: "OWNER" });
    const staff = await createTestUser({ role: "STAFF" });

    // 1. STAFF is rejected on every action & export
    mockRequireRole.mockImplementation(async (...roles: string[]) => {
      if (!roles.includes("STAFF")) throw new ForbiddenError();
      return staff;
    });

    const code = genId("m1test_inf").toUpperCase();
    await expect(
      createInfluencerAction({ name: "M1Test Creator", code, discountPercent: 10 })
    ).rejects.toThrow(ForbiddenError);
    await expect(
      updateInfluencerSettingsAction({ influencerCookieDays: 14 })
    ).rejects.toThrow(ForbiddenError);
    const forbiddenRes = await exportInfluencersCsv(
      new Request("http://localhost:3000/api/admin/influencers/export")
    );
    expect(forbiddenRes.status).toBe(403);

    // 2. OWNER creates influencer with 10% discount
    mockRequireRole.mockResolvedValue(owner);
    const created = await createInfluencerAction({
      name: "=M1Test Creator",
      code,
      email: "m1test_creator@example.test",
      discountPercent: 10,
    });

    const inf = await prisma.influencer.findUniqueOrThrow({
      where: { id: created.influencerId },
      include: { offer: true },
    });
    expect(inf.code).toBe(code);
    expect(inf.offer?.code).toBe(code);
    expect(inf.offer?.active).toBe(true);
    expect((inf.offer?.config as { percent?: number })?.percent).toBe(10);

    // 3. Duplicate code and unrelated Offer.code conflict rejected
    await expect(
      createInfluencerAction({ name: "M1Test Dup", code, discountPercent: 0 })
    ).rejects.toThrow("assigned to another influencer");

    const unrelatedCode = genId("M1TEST_OFF").toUpperCase();
    await prisma.offer.create({
      data: {
        id: genId("m1test_off"),
        name: "M1Test Unrelated Offer",
        kind: "PERCENT_OFF",
        code: unrelatedCode,
        active: true,
        config: { percent: 15 },
      },
    });
    await expect(
      createInfluencerAction({ name: "M1Test Conflict", code: unrelatedCode, discountPercent: 0 })
    ).rejects.toThrow("conflicts with an existing offer code");

    // 4. Deactivating deactivates linked Offer; clearing discount deactivates Offer
    await setInfluencerActiveAction(inf.id, false);
    const deactivatedOffer = await prisma.offer.findUnique({ where: { id: inf.offerId! } });
    expect(deactivatedOffer?.active).toBe(false);

    await setInfluencerActiveAction(inf.id, true);
    await updateInfluencerAction(inf.id, {
      name: "=M1Test Creator",
      code,
      email: "m1test_creator@example.test",
      discountPercent: 0,
    });
    const clearedOffer = await prisma.offer.findUnique({ where: { id: inf.offerId! } });
    expect(clearedOffer?.active).toBe(false);

    // 5. Stats with 2 attributed orders (1 fully refunded via ReturnRequest)
    const { product, variants } = await createTestProduct({ price: 100000 });
    const customer = await createTestUser();

    const o1 = await createTestOrder({
      userId: customer.id,
      shippingFee: 9900,
      total: 109900,
      paymentStatus: "PAID",
      fulfilmentStatus: "DELIVERED",
      items: [{ variantId: variants[0].id, productId: product.id, qty: 1, unitPrice: 100000 }],
    });
    const o2 = await createTestOrder({
      userId: customer.id,
      shippingFee: 0,
      total: 100000,
      paymentStatus: "PAID",
      fulfilmentStatus: "DELIVERED",
      items: [{ variantId: variants[0].id, productId: product.id, qty: 1, unitPrice: 100000 }],
    });

    await prisma.order.update({
      where: { id: o1.id },
      data: { influencerId: inf.id, influencerSource: "COUPON" },
    });
    await prisma.order.update({
      where: { id: o2.id },
      data: { influencerId: inf.id, influencerSource: "LINK" },
    });

    const o2Item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: o2.id } });
    await prisma.returnRequest.create({
      data: {
        id: genId("m1test_ret"),
        orderId: o2.id,
        userId: customer.id,
        status: "REFUNDED",
        reason: "Size issue",
        items: {
          create: {
            id: genId("m1test_ri"),
            orderItemId: o2Item.id,
            qty: 1,
          },
        },
      },
    });

    const stats = await getInfluencerStats({ influencerId: inf.id });
    expect(stats.influencers[0].summary).toEqual({
      ordersPlaced: 2,
      ordersDelivered: 2,
      goodsSalesPaise: 200000,
      refundedGoodsPaise: 100000,
      netGoodsPaise: 100000,
      couponOrders: 1,
      linkOrders: 1,
      selfOrders: 0,
    });

    // 6. CSV export neutralises formula injection
    const csvRes = await exportInfluencersCsv(
      new Request("http://localhost:3000/api/admin/influencers/export")
    );
    expect(csvRes.status).toBe(200);
    const csvText = await csvRes.text();
    expect(csvText).toContain("'=M1Test Creator");
  });

  it("cleared discount stays disabled after deactivate+activate until explicitly re-enabled, and CSV quotes commas/quotes", async () => {
    const owner = await createTestUser({ role: "OWNER" });
    mockRequireRole.mockResolvedValue(owner);

    const { product, variants } = await createTestProduct({ price: 100000 });
    const code = genId("m1test_clr").toUpperCase();
    const created = await createInfluencerAction({
      name: 'M1Test, "Quoted" Creator',
      code,
      discountPercent: 10,
    });

    // Clear discount (0), then deactivate + reactivate: quote must give NO discount
    await updateInfluencerAction(created.influencerId, {
      name: 'M1Test, "Quoted" Creator',
      code,
      discountPercent: 0,
    });
    await setInfluencerActiveAction(created.influencerId, false);
    await setInfluencerActiveAction(created.influencerId, true);

    const quoteCleared = await calculateQuote({
      items: [{ variantId: variants[0].id, productId: product.id, qty: 1 }],
      paymentMethod: "COD",
      couponCode: code,
    });
    expect(quoteCleared.discount).toBe(0);

    // Re-set 10%: quote gives 10% discount again
    await updateInfluencerAction(created.influencerId, {
      name: 'M1Test, "Quoted" Creator',
      code,
      discountPercent: 10,
    });
    const quoteRestored = await calculateQuote({
      items: [{ variantId: variants[0].id, productId: product.id, qty: 1 }],
      paymentMethod: "COD",
      couponCode: code,
    });
    expect(quoteRestored.discount).toBe(10000);

    const csvRes = await exportInfluencersCsv(
      new Request("http://localhost:3000/api/admin/influencers/export")
    );
    const csvText = await csvRes.text();
    expect(csvText).toContain('"M1Test, ""Quoted"" Creator"');
  });
});
