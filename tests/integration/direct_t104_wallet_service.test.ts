import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../helpers/prisma";
import { cleanupM1TestRows, createTestUser, genId } from "../helpers/fixtures";
import {
  creditWalletLot,
  debitWallet,
  expireWalletLots,
  getWalletSummary,
} from "@/lib/wallet/service";

describe("T104: Wallet Service (FIFO, Expiry, Idempotency, Legacy Isolation)", () => {
  let userId: string;

  beforeAll(async () => {
    await cleanupM1TestRows();
    const u = await createTestUser({ role: "CUSTOMER" });
    userId = u.id;
    // Seed a legacy storeCreditBalance to verify wallet service never reads or mutates it
    await prisma.user.update({
      where: { id: userId },
      data: { storeCreditBalance: 12345 },
    });
  });

  afterAll(async () => {
    try {
      await prisma.walletEntry.deleteMany({ where: { userId } });
      await prisma.walletLot.deleteMany({ where: { userId } });
    } finally {
      await cleanupM1TestRows();
    }
  });

  it("credits lots idempotently, debits earliest-expiry-first, and expires past-due lots", async () => {
    const now = new Date("2026-06-01T12:00:00.000Z");
    const soon = new Date("2026-06-10T12:00:00.000Z");
    const past = new Date("2026-05-01T12:00:00.000Z");
    const idemKey = genId("m1test_idem");

    // 1. Credit non-expiring REFUND lot
    const c1 = await creditWalletLot({
      userId,
      kind: "REFUND",
      amountPaise: 10000,
      reason: "Test refund lot",
      idempotencyKey: idemKey,
      now,
    });
    expect(c1.idempotent).toBe(false);
    expect(c1.balancePaise).toBe(10000);

    // Retry with same idempotencyKey -> no double credit
    const c1Retry = await creditWalletLot({
      userId,
      kind: "REFUND",
      amountPaise: 10000,
      reason: "Test refund lot",
      idempotencyKey: idemKey,
      now,
    });
    expect(c1Retry.idempotent).toBe(true);
    expect(c1Retry.balancePaise).toBe(10000);

    // 2. Credit expiring PROMO lot (soon)
    const c2 = await creditWalletLot({
      userId,
      kind: "PROMO",
      amountPaise: 4000,
      expiresAt: soon,
      reason: "Test promo lot",
      now,
    });
    expect(c2.balancePaise).toBe(14000);

    // 3. Debit 6000 paise -> consumes 4000 from PROMO first, then 2000 from REFUND
    const deb = await debitWallet({
      userId,
      amountPaise: 6000,
      reason: "Test debit",
      now,
    });
    expect(deb.balancePaise).toBe(8000);

    const summary = await getWalletSummary(userId, now);
    expect(summary.balancePaise).toBe(8000);
    expect(summary.byKind.PROMO).toBe(0);
    expect(summary.byKind.REFUND).toBe(8000);

    // 4. Insufficient balance throws
    await expect(
      debitWallet({ userId, amountPaise: 9000, reason: "Too much", now })
    ).rejects.toThrow("Insufficient wallet balance");

    // 5. Expired lot is zeroed by expireWalletLots
    await creditWalletLot({
      userId,
      kind: "PROMO",
      amountPaise: 2500,
      expiresAt: past,
      reason: "Already past due",
      now: new Date("2026-04-01T00:00:00.000Z"),
    });
    const exp = await expireWalletLots(now);
    expect(exp.expiredCount).toBeGreaterThanOrEqual(1);
    expect(exp.expiredPaise).toBeGreaterThanOrEqual(2500);

    const afterExp = await getWalletSummary(userId, now);
    expect(afterExp.balancePaise).toBe(8000);
  });

  it("does NOT read or write User.storeCreditBalance or StoreCreditTransaction", async () => {
    const userBefore = await prisma.user.findUnique({
      where: { id: userId },
      select: { storeCreditBalance: true },
    });
    expect(userBefore?.storeCreditBalance).toBe(12345);

    const legacyTxCount = await prisma.storeCreditTransaction.count({
      where: { userId },
    });
    expect(legacyTxCount).toBe(0);
  });
});
