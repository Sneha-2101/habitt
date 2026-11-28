import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { enqueueWalletExpiryWarnings } from "@/lib/wallet/service";
import { cleanupM1TestRows } from "../helpers/fixtures";

describe("direct_t125_wallet_expiry_warning", () => {
  const userWithEmailId = "m1test_t125_user_email";
  const userNoEmailId = "m1test_t125_user_no_email";
  const lotEligibleId = "m1test_t125_lot_eligible";
  const lotRefundId = "m1test_t125_lot_refund";
  const lotNullExpId = "m1test_t125_lot_null";
  const lotEmptyId = "m1test_t125_lot_empty";
  const lotExpiredId = "m1test_t125_lot_expired";
  const lotFarId = "m1test_t125_lot_far";
  const lotNoEmailId = "m1test_t125_lot_no_email";

  beforeAll(async () => {
    await cleanupM1TestRows();

    await prisma.user.createMany({
      data: [
        {
          id: userWithEmailId,
          email: "m1test_t125@example.com",
          name: "M1Test T125",
        },
        {
          id: userNoEmailId,
          email: null,
          phone: "9999999125",
          name: "M1Test T125 NoEmail",
        },
      ],
    });

    const now = new Date();
    const in3Days = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
    const in15Days = new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000);
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    await prisma.walletLot.createMany({
      data: [
        {
          id: lotEligibleId,
          userId: userWithEmailId,
          kind: "PROMO",
          originalPaise: 20000,
          remainingPaise: 15000,
          expiresAt: in3Days,
          sourceId: "m1test_t125_src_1",
        },
        {
          id: lotRefundId,
          userId: userWithEmailId,
          kind: "REFUND",
          originalPaise: 20000,
          remainingPaise: 20000,
          expiresAt: in3Days,
          sourceId: "m1test_t125_src_2",
        },
        {
          id: lotNullExpId,
          userId: userWithEmailId,
          kind: "PROMO",
          originalPaise: 20000,
          remainingPaise: 20000,
          expiresAt: null,
          sourceId: "m1test_t125_src_3",
        },
        {
          id: lotEmptyId,
          userId: userWithEmailId,
          kind: "PROMO",
          originalPaise: 20000,
          remainingPaise: 0,
          expiresAt: in3Days,
          sourceId: "m1test_t125_src_4",
        },
        {
          id: lotExpiredId,
          userId: userWithEmailId,
          kind: "PROMO",
          originalPaise: 20000,
          remainingPaise: 20000,
          expiresAt: yesterday,
          sourceId: "m1test_t125_src_5",
        },
        {
          id: lotFarId,
          userId: userWithEmailId,
          kind: "PROMO",
          originalPaise: 20000,
          remainingPaise: 20000,
          expiresAt: in15Days,
          sourceId: "m1test_t125_src_6",
        },
        {
          id: lotNoEmailId,
          userId: userNoEmailId,
          kind: "PROMO",
          originalPaise: 20000,
          remainingPaise: 20000,
          expiresAt: in3Days,
          sourceId: "m1test_t125_src_7",
        },
      ],
    });
  });

  afterAll(async () => {
    await cleanupM1TestRows();
  });

  it("enqueues WALLET_EXPIRY_WARNING once for eligible lots and skips all others", async () => {
    const res = await enqueueWalletExpiryWarnings(new Date());
    expect(res.warnedCount).toBeGreaterThanOrEqual(1);

    const outboxRow = await prisma.eventOutbox.findUnique({
      where: { dedupeKey: `wallet-expiry-warn:${lotEligibleId}` },
    });
    expect(outboxRow).not.toBeNull();
    expect(outboxRow?.type).toBe("WALLET_EXPIRY_WARNING");
    expect(outboxRow?.channel).toBe("EMAIL");
    expect((outboxRow?.payload as Record<string, unknown>)?.email).toBe("m1test_t125@example.com");
    expect((outboxRow?.payload as Record<string, unknown>)?.lotId).toBe(lotEligibleId);
    expect((outboxRow?.payload as Record<string, unknown>)?.amountPaise).toBe(15000);

    for (const skippedId of [
      lotRefundId,
      lotNullExpId,
      lotEmptyId,
      lotExpiredId,
      lotFarId,
      lotNoEmailId,
    ]) {
      const row = await prisma.eventOutbox.findUnique({
        where: { dedupeKey: `wallet-expiry-warn:${skippedId}` },
      });
      expect(row).toBeNull();
    }

    // Second run should be idempotent (alreadyWarned)
    const res2 = await enqueueWalletExpiryWarnings(new Date());
    expect(res2.warnedCount).toBe(0);
  });
});
