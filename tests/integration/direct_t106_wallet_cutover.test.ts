import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "../helpers/prisma";
import { cleanupM1TestRows, createTestUser, genId } from "../helpers/fixtures";
import * as guardsModule from "@/lib/guards";
import {
  creditWalletLot,
  debitWallet,
  getWalletBalance,
  refundToWallet,
  restoreWalletDebit,
} from "@/lib/wallet/service";
import { WALLET_RESTORE_GRACE_DAYS } from "@/lib/wallet/allocate";
import { updateRewardSettingsAction } from "@/lib/actions/wallet-admin";
import { SiteSettings } from "@prisma/client";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

describe("T106: Wallet Cutover Hardening (Locks, Restore, Grace, Refund, CHECK, RESTRICT)", () => {
  let ownerUser: { id: string; email: string; role: "OWNER" };
  let staffUser: { id: string; email: string; role: "STAFF" };
  let originalSettings: SiteSettings | null = null;

  beforeAll(async () => {
    originalSettings = await prisma.siteSettings.findUnique({ where: { id: "default" } });
    await cleanupM1TestRows();
    const o = await createTestUser({ role: "OWNER" });
    ownerUser = { id: o.id, email: o.email!, role: "OWNER" };
    const s = await createTestUser({ role: "STAFF" });
    staffUser = { id: s.id, email: s.email!, role: "STAFF" };
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
      await prisma.auditLog.deleteMany({
        where: { actorId: { in: [ownerUser.id, staffUser.id] } },
      });
    } finally {
      await cleanupM1TestRows();
    }
  });

  it("serializes parallel debits with advisory lock: two 8000 debits on 10000 -> exactly one succeeds", async () => {
    const user = await createTestUser();
    await creditWalletLot({ userId: user.id, kind: "REFUND", amountPaise: 10000, reason: "Seed 10000" });

    const [r1, r2] = await Promise.allSettled([
      debitWallet({ userId: user.id, amountPaise: 8000, reason: "Race 1" }),
      debitWallet({ userId: user.id, amountPaise: 8000, reason: "Race 2" }),
    ]);

    const fulfilled = [r1, r2].filter((r) => r.status === "fulfilled");
    const rejected = [r1, r2].filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const bal = await getWalletBalance(prisma, user.id);
    expect(bal).toBe(2000);

    const entries = await prisma.walletEntry.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
    });
    expect(entries[entries.length - 1].balanceAfterPaise).toBe(2000);
  });

  it("same-key multi-lot debit retried returns ALL entries and debits once", async () => {
    const user = await createTestUser();
    const now = new Date("2026-06-01T00:00:00.000Z");
    await creditWalletLot({
      userId: user.id,
      kind: "PROMO",
      amountPaise: 3000,
      expiresAt: new Date("2026-06-10T00:00:00.000Z"),
      reason: "Promo 1",
      now,
    });
    await creditWalletLot({
      userId: user.id,
      kind: "REFUND",
      amountPaise: 5000,
      reason: "Refund 1",
      now,
    });

    const key = genId("m1test_multilot");
    const first = await debitWallet({ userId: user.id, amountPaise: 6000, reason: "Multi-lot", idempotencyKey: key, now });
    expect(first.idempotent).toBe(false);
    expect(first.entries).toHaveLength(2);
    expect(first.balancePaise).toBe(2000);

    const retry = await debitWallet({ userId: user.id, amountPaise: 6000, reason: "Multi-lot", idempotencyKey: key, now });
    expect(retry.idempotent).toBe(true);
    expect(retry.entries).toHaveLength(2);
    expect(retry.balancePaise).toBe(2000);
  });

  it("restores to original lot, creates grace lot when expired, and caps partial+full restore at debit", async () => {
    const user = await createTestUser();
    const t0 = new Date("2026-06-01T00:00:00.000Z");
    const exp = new Date("2026-06-05T00:00:00.000Z");

    const promo = await creditWalletLot({
      userId: user.id,
      kind: "PROMO",
      amountPaise: 4000,
      expiresAt: exp,
      reason: "Promo",
      now: t0,
    });
    const refund = await creditWalletLot({
      userId: user.id,
      kind: "REFUND",
      amountPaise: 6000,
      reason: "Refund",
      now: t0,
    });

    const orderId = genId("m1test_ord_rest");
    await debitWallet({ userId: user.id, amountPaise: 7000, orderId, reason: "Order debit", now: t0 });

    // Partial restore 3000 before expiry -> LIFO restores into REFUND lot
    const part = await prisma.$transaction((tx) =>
      restoreWalletDebit(tx, {
        userId: user.id,
        orderId,
        amountPaise: 3000,
        reason: "Partial restore",
        idempotencyKey: genId("m1test_pr"),
        now: t0,
      })
    );
    expect(part.restoredPaise).toBe(3000);
    const refundAfterPart = await prisma.walletLot.findUnique({ where: { id: refund.lot!.id } });
    expect(refundAfterPart?.remainingPaise).toBe(6000);

    // Full restore of remaining 4000 AFTER promo expiry -> creates grace lot of kind PROMO (+7 days)
    const tAfterExp = new Date("2026-06-06T00:00:00.000Z");
    const full = await prisma.$transaction((tx) =>
      restoreWalletDebit(tx, {
        userId: user.id,
        orderId,
        reason: "Restored after expiry",
        idempotencyKey: genId("m1test_fr"),
        now: tAfterExp,
      })
    );
    expect(full.restoredPaise).toBe(4000);

    const graceLot = await prisma.walletLot.findFirst({
      where: { userId: user.id, sourceType: "RESTORE_GRACE" },
    });
    expect(graceLot).not.toBeNull();
    expect(graceLot?.kind).toBe("PROMO");
    expect(graceLot?.remainingPaise).toBe(4000);
    expect(graceLot?.expiresAt?.getTime()).toBe(
      tAfterExp.getTime() + WALLET_RESTORE_GRACE_DAYS * 24 * 60 * 60 * 1000
    );

    // Further restore is a no-op (0)
    const extra = await prisma.$transaction((tx) =>
      restoreWalletDebit(tx, {
        userId: user.id,
        orderId,
        reason: "Over-restore",
        idempotencyKey: genId("m1test_xr"),
        now: tAfterExp,
      })
    );
    expect(extra.restoredPaise).toBe(0);

    // Reconcile original promo lot (debited 4000, remaining 0)
    const promoLot = await prisma.walletLot.findUnique({ where: { id: promo.lot!.id } });
    expect(promoLot?.remainingPaise).toBe(0);
  });

  it("refundToWallet splits restorable order debit vs new REFUND lot", async () => {
    const user = await createTestUser();
    const orderId = genId("m1test_ord_ref");
    await creditWalletLot({ userId: user.id, kind: "REFUND", amountPaise: 3000, reason: "Seed" });
    await debitWallet({ userId: user.id, amountPaise: 3000, orderId, reason: "Order debit" });

    const refundId = genId("m1test_ref");
    const res = await prisma.$transaction((tx) =>
      refundToWallet(tx, {
        userId: user.id,
        orderId,
        amountPaise: 10000,
        refundId,
        reason: "Order return refund",
      })
    );
    expect(res.restoredPaise).toBe(3000);
    expect(res.creditedPaise).toBe(7000);
    expect(res.balancePaise).toBe(10000);
  });

  it("enforces DB CHECK constraints, RESTRICT on User delete, and never writes User.storeCreditBalance", async () => {
    const user = await createTestUser();
    await prisma.user.update({ where: { id: user.id }, data: { storeCreditBalance: 555 } });

    const created = await creditWalletLot({ userId: user.id, kind: "REFUND", amountPaise: 5000, reason: "Check test" });
    const lotId = created.lot!.id;

    // CHECK: remainingPaise > originalPaise rejected
    await expect(
      prisma.$executeRaw`UPDATE "WalletLot" SET "remainingPaise" = 6000 WHERE "id" = ${lotId}`
    ).rejects.toThrow();

    // CHECK: remainingPaise < 0 rejected
    await expect(
      prisma.$executeRaw`UPDATE "WalletLot" SET "remainingPaise" = -1 WHERE "id" = ${lotId}`
    ).rejects.toThrow();

    // RESTRICT: deleting user with wallet rows fails
    await expect(prisma.user.delete({ where: { id: user.id } })).rejects.toThrow();

    // User.storeCreditBalance untouched
    const uAfter = await prisma.user.findUnique({ where: { id: user.id }, select: { storeCreditBalance: true } });
    expect(uAfter?.storeCreditBalance).toBe(555);
  });

  it("updateRewardSettingsAction enforces OWNER-only, bounds, and writes AuditLog", async () => {
    vi.spyOn(guardsModule, "requireRole").mockRejectedValueOnce(new guardsModule.ForbiddenError());
    await expect(
      updateRewardSettingsAction({
        promoCreditExpiryDays: 120,
        walletMaxPercentOfOrder: 50,
        maxAdminAdjustPaise: 100000,
      })
    ).rejects.toThrow(guardsModule.ForbiddenError);

    vi.spyOn(guardsModule, "requireRole").mockResolvedValue(ownerUser);
    await expect(
      updateRewardSettingsAction({
        promoCreditExpiryDays: 0,
        walletMaxPercentOfOrder: 50,
        maxAdminAdjustPaise: 100000,
      })
    ).rejects.toThrow();

    const okRes = await updateRewardSettingsAction({
      promoCreditExpiryDays: 120,
      walletMaxPercentOfOrder: 50,
      maxAdminAdjustPaise: 200000,
    });
    expect(okRes.ok).toBe(true);
    expect(okRes.settings.walletMaxPercentOfOrder).toBe(50);

    const audit = await prisma.auditLog.findFirst({
      where: { actorId: ownerUser.id, action: "REWARD_SETTINGS_UPDATED", entityId: "default" },
    });
    expect(audit).not.toBeNull();
  });
});
