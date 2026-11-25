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
import {
  attachReferral,
  expireStaleReferrals,
  getOrCreateReferralCode,
  releaseReferrerRewards,
  sweepPendingRefereeCredits,
} from "@/lib/rewards/service";
import { getWalletBalance } from "@/lib/wallet/service";
import { updateLoyaltyReferralSettingsAction } from "@/lib/actions/wallet-admin";
import { applyReferralCodeAction } from "@/lib/actions/referral";
import { SiteSettings } from "@prisma/client";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

describe("T109: Referrals End-to-End, Anti-Abuse, Cap & Admin Settings", () => {
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
    await prisma.siteSettings.update({
      where: { id: "default" },
      data: {
        referralEnabled: true,
        refereeRewardPaise: 10000,
        referrerRewardPaise: 15000,
        referralMonthlyCapPerReferrer: 10,
        referralMinOrderPaise: 50000,
        referralValidityDays: 90,
        returnWindowDays: 7,
        promoCreditExpiryDays: 180,
      },
    });
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

  it("ignores invalid codes silently and blocks self-referral by normalized phone", async () => {
    const now = new Date("2026-06-20T00:00:00.000Z");
    const referrer = await createTestUser({
      email: `m1test_ref_${genId("e")}@example.test`,
      phone: "9876543210",
      emailVerifiedAt: now,
      phoneVerifiedAt: now,
    });
    const refCode = await getOrCreateReferralCode(referrer.id);

    const fri = await createTestUser({
      email: `m1test_f_${genId("e")}@example.test`,
      phone: "9111111111",
      emailVerifiedAt: now,
    });
    await attachReferral(fri.id, "INVALID99", now);
    expect(await prisma.referral.findUnique({ where: { refereeId: fri.id } })).toBeNull();

    const selfClone = await createTestUser({
      email: `m1test_self_${genId("e")}@example.test`,
      phone: "+91 9876543210",
      emailVerifiedAt: now,
      phoneVerifiedAt: now,
    });
    await attachReferral(selfClone.id, refCode.code, now);
    expect(await prisma.referral.findUnique({ where: { refereeId: selfClone.id } })).toBeNull();
  });

  it("grants friend credit only when BOTH email and phone are verified, via sweeper idempotently, and blocks duplicate identity claims", async () => {
    const now = new Date("2026-06-20T00:00:00.000Z");
    const referrer = await createTestUser({ emailVerifiedAt: now, phoneVerifiedAt: now });
    const refCode = await getOrCreateReferralCode(referrer.id);

    const fri = await createTestUser({
      email: `m1test_f_${genId("e")}@example.test`,
      phone: "9111111111",
      emailVerifiedAt: now,
      phoneVerifiedAt: null,
    });
    await attachReferral(fri.id, refCode.code, now);
    expect((await prisma.referral.findUnique({ where: { refereeId: fri.id } }))?.status).toBe("PENDING_VERIFICATION");
    expect(await getWalletBalance(prisma, fri.id, now)).toBe(0);

    await prisma.user.update({ where: { id: fri.id }, data: { phoneVerifiedAt: now } });
    expect((await sweepPendingRefereeCredits(now)).grantedCount).toBe(1);
    expect(await getWalletBalance(prisma, fri.id, now)).toBe(10000);
    expect((await sweepPendingRefereeCredits(now)).grantedCount).toBe(0);

    const friClone = await createTestUser({
      email: fri.email!.toUpperCase(),
      phone: "9222222222",
      emailVerifiedAt: now,
      phoneVerifiedAt: now,
    });
    await attachReferral(friClone.id, refCode.code, now);
    expect(await prisma.referral.findUnique({ where: { refereeId: friClone.id } })).toBeNull();
  });

  it("rewards referrer only after delivered + returnWindowDays, and rejects when first order is fully returned", async () => {
    const now = new Date("2026-06-20T00:00:00.000Z");
    const referrer = await createTestUser({ emailVerifiedAt: now, phoneVerifiedAt: now });
    const refCode = await getOrCreateReferralCode(referrer.id);
    const { product, variants } = await createTestProduct({ price: 100000 });

    const fri1 = await createTestUser({ emailVerifiedAt: now, phoneVerifiedAt: now });
    await attachReferral(fri1.id, refCode.code, now);
    await createTestOrder({
      userId: fri1.id,
      items: [{ variantId: variants[0].id, productId: product.id, qty: 1, unitPrice: 100000 }],
      status: "DELIVERED",
      deliveredAt: new Date("2026-06-18T00:00:00.000Z"), // inside 7d window
      total: 100000,
    });
    expect((await releaseReferrerRewards(now)).rewardedCount).toBe(0);

    // Move deliveredAt past window
    await prisma.order.updateMany({
      where: { userId: fri1.id },
      data: { deliveredAt: new Date("2026-06-05T00:00:00.000Z") },
    });
    expect((await releaseReferrerRewards(now)).rewardedCount).toBe(1);
    expect(await getWalletBalance(prisma, referrer.id, now)).toBe(15000);

    // Fully returned first order -> REJECTED FIRST_ORDER_RETURNED
    const fri2 = await createTestUser({ emailVerifiedAt: now, phoneVerifiedAt: now });
    await attachReferral(fri2.id, refCode.code, now);
    const ord2 = await createTestOrder({
      userId: fri2.id,
      items: [{ variantId: variants[0].id, productId: product.id, qty: 1, unitPrice: 100000 }],
      status: "DELIVERED",
      deliveredAt: new Date("2026-06-05T00:00:00.000Z"),
      total: 100000,
    });
    const ret2 = await prisma.returnRequest.create({
      data: { id: genId("m1test_ret"), orderId: ord2.id, userId: fri2.id, reason: "Return", status: "REFUNDED" },
    });
    await prisma.returnItem.create({
      data: { id: genId("m1test_ri"), returnId: ret2.id, orderItemId: ord2.items[0].id, qty: 1 },
    });

    expect((await releaseReferrerRewards(now)).rejectedCount).toBe(1);
    const ref2 = await prisma.referral.findUnique({ where: { refereeId: fri2.id } });
    expect(ref2?.status).toBe("REJECTED");
    expect(ref2?.rejectionReason).toBe("FIRST_ORDER_RETURNED");
  });

  it("enforces monthly cap per referrer and expires stale referrals", async () => {
    const now = new Date("2026-06-20T00:00:00.000Z");
    await prisma.siteSettings.update({
      where: { id: "default" },
      data: { referralMonthlyCapPerReferrer: 1 },
    });
    const referrer = await createTestUser({ emailVerifiedAt: now, phoneVerifiedAt: now });
    const refCode = await getOrCreateReferralCode(referrer.id);
    const { product, variants } = await createTestProduct({ price: 100000 });

    const f1 = await createTestUser({ emailVerifiedAt: now, phoneVerifiedAt: now });
    await attachReferral(f1.id, refCode.code, now);
    await createTestOrder({
      userId: f1.id,
      items: [{ variantId: variants[0].id, productId: product.id, qty: 1, unitPrice: 100000 }],
      status: "DELIVERED",
      deliveredAt: new Date("2026-06-05T00:00:00.000Z"),
      total: 100000,
    });
    expect((await releaseReferrerRewards(now)).rewardedCount).toBe(1);

    const f2 = await createTestUser({ emailVerifiedAt: now, phoneVerifiedAt: now });
    await attachReferral(f2.id, refCode.code, now);
    await createTestOrder({
      userId: f2.id,
      items: [{ variantId: variants[0].id, productId: product.id, qty: 1, unitPrice: 100000 }],
      status: "DELIVERED",
      deliveredAt: new Date("2026-06-05T00:00:00.000Z"),
      total: 100000,
    });
    expect((await releaseReferrerRewards(now)).rejectedCount).toBe(1);
    expect((await prisma.referral.findUnique({ where: { refereeId: f2.id } }))?.rejectionReason).toBe("MONTHLY_CAP_REACHED");

    const f3 = await createTestUser({ emailVerifiedAt: now, phoneVerifiedAt: null });
    await attachReferral(f3.id, refCode.code, now);
    const farFuture = new Date(now.getTime() + 91 * 86400_000);
    expect((await expireStaleReferrals(farFuture)).expiredCount).toBeGreaterThanOrEqual(1);
    expect((await prisma.referral.findUnique({ where: { refereeId: f3.id } }))?.status).toBe("EXPIRED");
  });

  it("grants nothing when referralEnabled is false", async () => {
    const now = new Date("2026-06-20T00:00:00.000Z");
    await prisma.siteSettings.update({ where: { id: "default" }, data: { referralEnabled: false } });
    const referrer = await createTestUser({ emailVerifiedAt: now, phoneVerifiedAt: now });
    const refCode = await getOrCreateReferralCode(referrer.id);
    const fri = await createTestUser({ emailVerifiedAt: now, phoneVerifiedAt: now });

    await attachReferral(fri.id, refCode.code, now);
    expect(await prisma.referral.findUnique({ where: { refereeId: fri.id } })).toBeNull();
    expect(await getWalletBalance(prisma, fri.id, now)).toBe(0);
  });

  it("rejects accounts older than 24h via both attachReferral and neutral applyReferralCodeAction", async () => {
    const now = new Date();
    const oldCreatedAt = new Date(now.getTime() - 25 * 60 * 60 * 1000);
    const referrer = await createTestUser({ emailVerifiedAt: now, phoneVerifiedAt: now });
    const refCode = await getOrCreateReferralCode(referrer.id);

    const oldUser = await createTestUser({ emailVerifiedAt: now, phoneVerifiedAt: now, createdAt: oldCreatedAt });
    await attachReferral(oldUser.id, refCode.code, now);
    expect(await prisma.referral.findUnique({ where: { refereeId: oldUser.id } })).toBeNull();

    // Also via neutral form action
    vi.spyOn(guardsModule, "requireUser").mockResolvedValueOnce({ id: oldUser.id, role: "CUSTOMER" });
    const oldActionRes = await applyReferralCodeAction(refCode.code);
    expect(oldActionRes.message).toBe("If the code is valid and your account is eligible, it has been noted.");
    expect(await prisma.referral.findUnique({ where: { refereeId: oldUser.id } })).toBeNull();

    // New account within 24h passes with identical neutral response
    const newUser = await createTestUser({ emailVerifiedAt: now, phoneVerifiedAt: now, createdAt: now });
    vi.spyOn(guardsModule, "requireUser").mockResolvedValueOnce({ id: newUser.id, role: "CUSTOMER" });
    const newActionRes = await applyReferralCodeAction(refCode.code);
    expect(newActionRes.message).toBe(oldActionRes.message);
    expect(await prisma.referral.findUnique({ where: { refereeId: newUser.id } })).not.toBeNull();
  });

  it("isolates per-row errors in releaseReferrerRewards so one failing referral returns errorCount=1 while others succeed", async () => {
    const now = new Date("2026-06-20T00:00:00.000Z");
    const referrer = await createTestUser({ emailVerifiedAt: now, phoneVerifiedAt: now });
    const refCode = await getOrCreateReferralCode(referrer.id);
    const { product, variants } = await createTestProduct({ price: 100000 });

    const fBad = await createTestUser({ emailVerifiedAt: now, phoneVerifiedAt: now });
    await attachReferral(fBad.id, refCode.code, now);
    const badRef = await prisma.referral.findUniqueOrThrow({ where: { refereeId: fBad.id } });
    await createTestOrder({
      userId: fBad.id,
      items: [{ variantId: variants[0].id, productId: product.id, qty: 1, unitPrice: 100000 }],
      status: "DELIVERED",
      deliveredAt: new Date("2026-06-05T00:00:00.000Z"),
      total: 100000,
    });
    // Pre-insert conflicting WalletLot for referrer so creditWalletLot hits P2002 on badRef
    await prisma.walletLot.create({
      data: {
        id: genId("m1test_wlot"),
        userId: referrer.id,
        kind: "PROMO",
        originalPaise: 1000,
        remainingPaise: 1000,
        sourceType: "REFERRAL_REFERRER",
        sourceId: badRef.id,
      },
    });

    const fGood = await createTestUser({ emailVerifiedAt: now, phoneVerifiedAt: now });
    await attachReferral(fGood.id, refCode.code, now);
    await createTestOrder({
      userId: fGood.id,
      items: [{ variantId: variants[0].id, productId: product.id, qty: 1, unitPrice: 100000 }],
      status: "DELIVERED",
      deliveredAt: new Date("2026-06-05T00:00:00.000Z"),
      total: 100000,
    });

    const res = await releaseReferrerRewards(now);
    expect(res.errorCount).toBe(1);
    expect(res.rewardedCount).toBe(1);
  });

  it("updateLoyaltyReferralSettingsAction enforces OWNER-only, bounds, and writes AuditLog", async () => {
    vi.spyOn(guardsModule, "requireRole").mockRejectedValueOnce(new guardsModule.ForbiddenError());
    await expect(
      updateLoyaltyReferralSettingsAction({
        loyaltyEnabled: true,
        loyaltyModel: "FLAT_PERCENT",
        loyaltyPercentBps: 200,
        referralEnabled: true,
        referrerRewardPaise: 5000,
        refereeRewardPaise: 5000,
        referralMonthlyCapPerReferrer: 5,
        referralMinOrderPaise: 50000,
        referralValidityDays: 90,
      })
    ).rejects.toThrow(guardsModule.ForbiddenError);

    vi.spyOn(guardsModule, "requireRole").mockResolvedValue(ownerUser);
    await expect(
      updateLoyaltyReferralSettingsAction({
        loyaltyEnabled: true,
        loyaltyModel: "FLAT_PERCENT",
        loyaltyPercentBps: 9999,
        referralEnabled: false,
        referrerRewardPaise: 0,
        refereeRewardPaise: 0,
        referralMonthlyCapPerReferrer: 10,
        referralMinOrderPaise: 0,
        referralValidityDays: 90,
      })
    ).rejects.toThrow();

    const okRes = await updateLoyaltyReferralSettingsAction({
      loyaltyEnabled: true,
      loyaltyModel: "FLAT_PERCENT",
      loyaltyPercentBps: 300,
      referralEnabled: true,
      referrerRewardPaise: 10000,
      refereeRewardPaise: 5000,
      referralMonthlyCapPerReferrer: 5,
      referralMinOrderPaise: 50000,
      referralValidityDays: 60,
    });
    expect(okRes.ok).toBe(true);
    expect(okRes.settings.loyaltyPercentBps).toBe(300);

    const audit = await prisma.auditLog.findFirst({
      where: { actorId: ownerUser.id, action: "LOYALTY_REFERRAL_SETTINGS_UPDATED" },
    });
    expect(audit).not.toBeNull();
  });
});
