import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { prisma } from "../helpers/prisma";
import {
  cleanupM1TestRows,
  createTestOrder,
  createTestProduct,
  createTestUser,
  genId,
} from "../helpers/fixtures";
import * as guardsModule from "@/lib/guards";
import { updateLoyaltyReferralSettingsAction } from "@/lib/actions/wallet-admin";
import { releaseLoyaltyAccruals } from "@/lib/rewards/service";
import { getWalletBalance } from "@/lib/wallet/service";
import { SiteSettings } from "@prisma/client";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

describe("T108: Loyalty Accrual Cron & Rules", () => {
  let originalSettings: SiteSettings | null = null;
  let ownerUser: { id: string; email: string; role: "OWNER" };

  beforeAll(async () => {
    originalSettings = await prisma.siteSettings.findUnique({ where: { id: "default" } });
    await cleanupM1TestRows();
    const o = await createTestUser({ role: "OWNER" });
    ownerUser = { id: o.id, email: o.email!, role: "OWNER" };
  });

  beforeEach(async () => {
    await cleanupM1TestRows();
    const o = await createTestUser({ role: "OWNER" });
    ownerUser = { id: o.id, email: o.email!, role: "OWNER" };
  });

  afterAll(async () => {
    try {
      if (originalSettings) {
        const { id: _id, updatedAt: _up, ...rest } = originalSettings;
        void _id;
        void _up;
        await prisma.siteSettings.upsert({
          where: { id: "default" },
          create: { id: "default", ...rest },
          update: { ...rest },
        });
      }
      await prisma.auditLog.deleteMany({ where: { actorId: ownerUser.id } });
    } finally {
      await cleanupM1TestRows();
    }
  });

  it("earns nothing when loyaltyEnabled is false", async () => {
    const now = new Date("2026-06-20T00:00:00.000Z");
    await prisma.siteSettings.update({
      where: { id: "default" },
      data: { loyaltyEnabled: false, loyaltyEnabledAt: new Date("2026-05-01T00:00:00.000Z"), loyaltyPercentBps: 500, returnWindowDays: 7 },
    });
    const user = await createTestUser();
    const { product, variants } = await createTestProduct({ price: 100000 });
    await createTestOrder({
      userId: user.id,
      items: [{ variantId: variants[0].id, productId: product.id, qty: 1, unitPrice: 100000 }],
      status: "DELIVERED",
      deliveredAt: new Date("2026-06-05T00:00:00.000Z"),
      createdAt: new Date("2026-06-01T00:00:00.000Z"),
      total: 100000,
    });

    const res = await releaseLoyaltyAccruals(now);
    expect(res.creditedCount).toBe(0);
    expect(await getWalletBalance(prisma, user.id, now)).toBe(0);
  });

  it("does not credit delivered orders still inside returnWindowDays", async () => {
    const now = new Date("2026-06-20T00:00:00.000Z");
    await prisma.siteSettings.update({
      where: { id: "default" },
      data: { loyaltyEnabled: true, loyaltyEnabledAt: new Date("2026-05-01T00:00:00.000Z"), loyaltyPercentBps: 500, returnWindowDays: 7 },
    });
    const user = await createTestUser();
    const { product, variants } = await createTestProduct({ price: 100000 });
    const ord = await createTestOrder({
      userId: user.id,
      items: [{ variantId: variants[0].id, productId: product.id, qty: 1, unitPrice: 100000 }],
      status: "DELIVERED",
      deliveredAt: new Date("2026-06-18T00:00:00.000Z"),
      createdAt: new Date("2026-06-15T00:00:00.000Z"),
      total: 100000,
    });

    const res = await releaseLoyaltyAccruals(now);
    expect(res.creditedCount).toBe(0);
    expect(await prisma.loyaltyAccrual.findUnique({ where: { orderId: ord.id } })).toBeNull();
  });

  it("blocks accrual while a return is open, then credits PROMO lot after partial return & window close idempotently", async () => {
    const now = new Date("2026-06-20T00:00:00.000Z");
    await prisma.siteSettings.update({
      where: { id: "default" },
      data: { loyaltyEnabled: true, loyaltyEnabledAt: new Date("2026-05-01T00:00:00.000Z"), loyaltyPercentBps: 500, returnWindowDays: 7, promoCreditExpiryDays: 180 },
    });
    const user = await createTestUser();
    const { product, variants } = await createTestProduct({ price: 100000 });
    const ord = await createTestOrder({
      userId: user.id,
      items: [{ variantId: variants[0].id, productId: product.id, qty: 2, unitPrice: 100000 }],
      status: "DELIVERED",
      deliveredAt: new Date("2026-06-05T00:00:00.000Z"),
      createdAt: new Date("2026-06-01T00:00:00.000Z"),
      total: 200000,
    });

    const ret = await prisma.returnRequest.create({
      data: { id: genId("m1test_ret"), orderId: ord.id, userId: user.id, reason: "Size", status: "REQUESTED" },
    });
    expect((await releaseLoyaltyAccruals(now)).creditedCount).toBe(0);

    await prisma.returnItem.create({
      data: { id: genId("m1test_ri"), returnId: ret.id, orderItemId: ord.items[0].id, qty: 1 },
    });
    await prisma.returnRequest.update({ where: { id: ret.id }, data: { status: "REFUNDED" } });

    const res = await releaseLoyaltyAccruals(now);
    expect(res.creditedCount).toBe(1);
    expect(await getWalletBalance(prisma, user.id, now)).toBe(5000);

    const lot = await prisma.walletLot.findFirst({ where: { userId: user.id, sourceType: "LOYALTY", sourceId: ord.id } });
    expect(lot?.kind).toBe("PROMO");
    expect(lot?.expiresAt).not.toBeNull();

    // Idempotent on retry
    const retry = await releaseLoyaltyAccruals(now);
    expect(retry.creditedCount).toBe(0);
    expect(await getWalletBalance(prisma, user.id, now)).toBe(5000);
  });

  it("records SKIPPED with 0 earned on wallet-only orders", async () => {
    const now = new Date("2026-06-20T00:00:00.000Z");
    await prisma.siteSettings.update({
      where: { id: "default" },
      data: { loyaltyEnabled: true, loyaltyEnabledAt: new Date("2026-05-01T00:00:00.000Z"), loyaltyPercentBps: 500, returnWindowDays: 7 },
    });
    const user = await createTestUser();
    const { product, variants } = await createTestProduct({ price: 100000 });
    const ord = await createTestOrder({
      userId: user.id,
      items: [{ variantId: variants[0].id, productId: product.id, qty: 1, unitPrice: 100000 }],
      status: "DELIVERED",
      deliveredAt: new Date("2026-06-05T00:00:00.000Z"),
      createdAt: new Date("2026-06-01T00:00:00.000Z"),
      storeCreditApplied: 100000,
      paymentMethod: "STORE_CREDIT",
      total: 100000,
    });

    const res = await releaseLoyaltyAccruals(now);
    expect(res.skippedCount).toBe(1);
    const acc = await prisma.loyaltyAccrual.findUnique({ where: { orderId: ord.id } });
    expect(acc?.status).toBe("SKIPPED");
    expect(acc?.earnedPaise).toBe(0);
  });

  it("earns on total - shippingFee - codFee for orders with item discount AND coupon", async () => {
    const now = new Date("2026-06-20T00:00:00.000Z");
    await prisma.siteSettings.update({
      where: { id: "default" },
      data: { loyaltyEnabled: true, loyaltyEnabledAt: new Date("2026-05-01T00:00:00.000Z"), loyaltyPercentBps: 500, returnWindowDays: 7 },
    });
    const user = await createTestUser();
    const { product, variants } = await createTestProduct({ price: 100000 });
    // Goods gross 100000 - 10000 item discount - 10000 coupon = 80000 net goods + 5000 shipping + 5000 cod = 90000 total
    const ord = await createTestOrder({
      userId: user.id,
      items: [{ variantId: variants[0].id, productId: product.id, qty: 1, unitPrice: 100000, discountPaise: 10000 }],
      status: "DELIVERED",
      deliveredAt: new Date("2026-06-05T00:00:00.000Z"),
      createdAt: new Date("2026-06-01T00:00:00.000Z"),
      shippingFee: 5000,
      codFee: 5000,
      discountAmount: 20000,
      total: 90000,
    });

    const res = await releaseLoyaltyAccruals(now);
    expect(res.creditedCount).toBe(1);
    const acc = await prisma.loyaltyAccrual.findUnique({ where: { orderId: ord.id } });
    expect(acc?.basePaise).toBe(80000);
    expect(acc?.earnedPaise).toBe(4000); // 5% of 80000
  });

  it("enabling loyalty sets loyaltyEnabledAt; pre-enable and disabled-gap orders never earn", async () => {
    vi.spyOn(guardsModule, "requireRole").mockResolvedValue(ownerUser);

    await prisma.siteSettings.update({
      where: { id: "default" },
      data: { loyaltyEnabled: false, loyaltyEnabledAt: null },
    });

    const user = await createTestUser();
    const { product, variants } = await createTestProduct({ price: 100000 });

    // Order placed BEFORE enabling
    const preOrd = await createTestOrder({
      userId: user.id,
      items: [{ variantId: variants[0].id, productId: product.id, qty: 1, unitPrice: 100000 }],
      status: "DELIVERED",
      deliveredAt: new Date(Date.now() - 10 * 86400_000),
      createdAt: new Date(Date.now() - 15 * 86400_000),
      total: 100000,
    });

    // Enable loyalty -> sets loyaltyEnabledAt
    const enableRes = await updateLoyaltyReferralSettingsAction({
      loyaltyEnabled: true,
      loyaltyModel: "FLAT_PERCENT",
      loyaltyPercentBps: 500,
      referralEnabled: false,
      referrerRewardPaise: 0,
      refereeRewardPaise: 0,
      referralMonthlyCapPerReferrer: 10,
      referralMinOrderPaise: 0,
      referralValidityDays: 90,
    });
    expect(enableRes.settings.loyaltyEnabledAt).not.toBeNull();

    // Pre-enable order must not earn
    const run1 = await releaseLoyaltyAccruals(new Date(Date.now() + 86400_000));
    expect(run1.creditedCount).toBe(0);
    expect(await prisma.loyaltyAccrual.findUnique({ where: { orderId: preOrd.id } })).toBeNull();

    // Disable loyalty, place an order while disabled, then re-enable -> still must not earn
    await updateLoyaltyReferralSettingsAction({
      loyaltyEnabled: false,
      loyaltyModel: "FLAT_PERCENT",
      loyaltyPercentBps: 500,
      referralEnabled: false,
      referrerRewardPaise: 0,
      refereeRewardPaise: 0,
      referralMonthlyCapPerReferrer: 10,
      referralMinOrderPaise: 0,
      referralValidityDays: 90,
    });
    const gapOrd = await createTestOrder({
      userId: user.id,
      items: [{ variantId: variants[0].id, productId: product.id, qty: 1, unitPrice: 100000 }],
      status: "DELIVERED",
      deliveredAt: new Date(Date.now() - 8 * 86400_000),
      createdAt: new Date(Date.now() - 10000),
      total: 100000,
    });
    await updateLoyaltyReferralSettingsAction({
      loyaltyEnabled: true,
      loyaltyModel: "FLAT_PERCENT",
      loyaltyPercentBps: 500,
      referralEnabled: false,
      referrerRewardPaise: 0,
      refereeRewardPaise: 0,
      referralMonthlyCapPerReferrer: 10,
      referralMinOrderPaise: 0,
      referralValidityDays: 90,
    });

    const run2 = await releaseLoyaltyAccruals(new Date(Date.now() + 10 * 86400_000));
    expect(run2.creditedCount).toBe(0);
    expect(await prisma.loyaltyAccrual.findUnique({ where: { orderId: gapOrd.id } })).toBeNull();
  });

  it("isolates per-row errors so one failing order does not stop other orders and reports errorCount=1", async () => {
    const now = new Date("2026-06-20T00:00:00.000Z");
    await prisma.siteSettings.update({
      where: { id: "default" },
      data: { loyaltyEnabled: true, loyaltyEnabledAt: new Date("2026-05-01T00:00:00.000Z"), loyaltyPercentBps: 500, returnWindowDays: 7 },
    });

    const user = await createTestUser();
    const { product, variants } = await createTestProduct({ price: 100000 });
    const badOrd = await createTestOrder({
      userId: user.id,
      items: [{ variantId: variants[0].id, productId: product.id, qty: 1, unitPrice: 100000 }],
      status: "DELIVERED",
      deliveredAt: new Date("2026-06-05T00:00:00.000Z"),
      createdAt: new Date("2026-06-01T00:00:00.000Z"),
      total: 100000,
    });
    // Pre-insert conflicting WalletLot (same userId, kind=PROMO, sourceType=LOYALTY, sourceId=badOrd.id) to force P2002 inside badOrd's tx
    await prisma.walletLot.create({
      data: {
        id: genId("m1test_wlot"),
        userId: user.id,
        kind: "PROMO",
        originalPaise: 1000,
        remainingPaise: 1000,
        sourceType: "LOYALTY",
        sourceId: badOrd.id,
      },
    });

    const goodOrd = await createTestOrder({
      userId: user.id,
      items: [{ variantId: variants[0].id, productId: product.id, qty: 1, unitPrice: 100000 }],
      status: "DELIVERED",
      deliveredAt: new Date("2026-06-05T00:00:00.000Z"),
      createdAt: new Date("2026-06-01T00:00:00.000Z"),
      total: 100000,
    });

    const res = await releaseLoyaltyAccruals(now);
    expect(res.errorCount).toBe(1);
    expect(res.creditedCount).toBe(1);
    expect(await prisma.loyaltyAccrual.findUnique({ where: { orderId: goodOrd.id } })).not.toBeNull();
  });
});
