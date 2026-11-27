import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma } from "../helpers/prisma";
import { createTestUser, cleanupM1TestRows, genId } from "../helpers/fixtures";

const mockRequireRole = vi.fn();
const mockRequireUser = vi.fn();

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ "x-forwarded-for": "198.51.100.42" })),
}));
vi.mock("@/lib/guards", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/guards")>();
  return {
    ...actual,
    requireRole: (...roles: string[]) => mockRequireRole(...roles),
    requireUser: () => mockRequireUser(),
  };
});

import {
  issueGiftCardsAction,
  voidGiftCardAction,
  listGiftCards,
  redeemGiftCardAction,
} from "@/lib/actions/gift-cards";
import {
  generateGiftCardCode,
  hashCode,
  normalizeCode,
  getCodeLast4,
} from "@/lib/gift-cards/code";
import { expireWalletLots, getWalletBalance } from "@/lib/wallet/service";
import { resetMemoryLimits } from "@/lib/ratelimit";

const GENERIC_MSG = "This code isn't valid or can't be used.";

function futureIstDateString(daysAhead: number): string {
  const d = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000 + 5.5 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

describe("T120: Owner-Issued Gift Cards", () => {
  beforeEach(async () => {
    resetMemoryLimits();
    await cleanupM1TestRows();
  });

  afterAll(async () => {
    await cleanupM1TestRows();
  });

  it("issues cards with hash-only storage, redeems with lowercase+spaces, survives wallet-expiry cron, and writes clean audits", async () => {
    const owner = await createTestUser({ role: "OWNER" });
    const customer = await createTestUser({ role: "CUSTOMER" });
    mockRequireRole.mockResolvedValue(owner);
    mockRequireUser.mockResolvedValue(customer);

    const issued = await issueGiftCardsAction({
      amountRupees: 500,
      redeemBy: futureIstDateString(30),
      quantity: 1,
      note: "m1test welcome gift",
    });

    expect(issued.cards).toHaveLength(1);
    const card = issued.cards[0];
    expect(card.amountPaise).toBe(50000);

    // DB stores hash only, never plaintext
    const dbRow = await prisma.giftCard.findUniqueOrThrow({ where: { id: card.id } });
    const norm = normalizeCode(card.code)!;
    expect(dbRow.codeHash).toBe(hashCode(norm));
    expect(dbRow.codeHash).not.toBe(card.code);
    expect(dbRow.codeHash).not.toBe(norm);
    expect(dbRow.last4).toBe(getCodeLast4(norm));
    expect(dbRow.status).toBe("ISSUED");

    // Audit row for issue has no code or hash
    const issueAudits = await prisma.auditLog.findMany({
      where: { entity: "GiftCard", entityId: card.id, action: "gift_card.issue" },
    });
    expect(issueAudits).toHaveLength(1);
    const issueMetaStr = JSON.stringify(issueAudits[0].meta);
    expect(issueMetaStr).not.toContain(norm);
    expect(issueMetaStr).not.toContain(card.code);
    expect(issueMetaStr).not.toContain(dbRow.codeHash);
    expect(issueAudits[0].meta).toEqual({
      id: card.id,
      last4: card.last4,
      amountPaise: 50000,
    });

    // Redeem with lowercase + spaces
    const spacedLower = `  ${card.code.toLowerCase().replace(/-/g, "  ")}  `;
    const redeemRes = await redeemGiftCardAction(spacedLower);
    expect(redeemRes).toEqual({
      ok: true,
      amountPaise: 50000,
      balancePaise: 50000,
    });

    const bal = await getWalletBalance(prisma, customer.id);
    expect(bal).toBe(50000);

    // Wallet lot is never-expiring
    const redeemedCard = await prisma.giftCard.findUniqueOrThrow({
      where: { id: card.id },
      include: { walletLot: true },
    });
    expect(redeemedCard.status).toBe("REDEEMED");
    expect(redeemedCard.redeemedById).toBe(customer.id);
    expect(redeemedCard.walletLot).not.toBeNull();
    expect(redeemedCard.walletLot?.expiresAt).toBeNull();

    // Redeemed credit survives wallet-expiry cron far in the future
    const farFuture = new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000);
    await expireWalletLots(farFuture);
    const balAfterCron = await getWalletBalance(prisma, customer.id, farFuture);
    expect(balAfterCron).toBe(50000);

    // Second redeem fails with identical generic message
    const secondRedeem = await redeemGiftCardAction(card.code);
    expect(secondRedeem).toEqual({ ok: false, error: GENERIC_MSG });

    // Audit row for redeem has no code or hash
    const redeemAudits = await prisma.auditLog.findMany({
      where: { entity: "GiftCard", entityId: card.id, action: "gift_card.redeem" },
    });
    expect(redeemAudits).toHaveLength(1);
    const redeemMetaStr = JSON.stringify(redeemAudits[0].meta);
    expect(redeemMetaStr).not.toContain(norm);
    expect(redeemMetaStr).not.toContain(dbRow.codeHash);
    expect(redeemAudits[0].meta).toEqual({
      id: card.id,
      last4: card.last4,
      amountPaise: 50000,
    });
  });

  it("returns identical generic message for wrong, malformed, void, and expired codes", async () => {
    const owner = await createTestUser({ role: "OWNER" });
    const customer = await createTestUser({ role: "CUSTOMER" });
    mockRequireRole.mockResolvedValue(owner);
    mockRequireUser.mockResolvedValue(customer);

    // Voided card
    const voidIssued = await issueGiftCardsAction({
      amountRupees: 200,
      redeemBy: futureIstDateString(10),
      quantity: 1,
      note: "m1test void target",
    });
    await voidGiftCardAction(voidIssued.cards[0].id);

    // Expired card (created directly in DB with past redeemBy)
    const expCode = generateGiftCardCode();
    const expNorm = normalizeCode(expCode)!;
    await prisma.giftCard.create({
      data: {
        id: genId("m1test_gc"),
        codeHash: hashCode(expNorm),
        last4: getCodeLast4(expNorm),
        amountPaise: 10000,
        status: "ISSUED",
        redeemBy: new Date(Date.now() - 60_000),
        note: "m1test expired",
        createdById: owner.id,
      },
    });

    const wrongRes = await redeemGiftCardAction(generateGiftCardCode());
    const malformedRes = await redeemGiftCardAction("INVALID-CODE-000");
    const voidRes = await redeemGiftCardAction(voidIssued.cards[0].code);
    const expiredRes = await redeemGiftCardAction(expCode);

    expect(wrongRes).toEqual({ ok: false, error: GENERIC_MSG });
    expect(malformedRes).toEqual({ ok: false, error: GENERIC_MSG });
    expect(voidRes).toEqual({ ok: false, error: GENERIC_MSG });
    expect(expiredRes).toEqual({ ok: false, error: GENERIC_MSG });

    // Void audit has no code/hash
    const voidAudits = await prisma.auditLog.findMany({
      where: {
        entity: "GiftCard",
        entityId: voidIssued.cards[0].id,
        action: "gift_card.void",
      },
    });
    expect(voidAudits).toHaveLength(1);
    expect(voidAudits[0].meta).toEqual({
      id: voidIssued.cards[0].id,
      last4: voidIssued.cards[0].last4,
      amountPaise: 20000,
    });
  });

  it("allows only 1 success across 10 parallel redeems of a single code", async () => {
    const owner = await createTestUser({ role: "OWNER" });
    const customer = await createTestUser({ role: "CUSTOMER" });
    mockRequireRole.mockResolvedValue(owner);
    mockRequireUser.mockResolvedValue(customer);

    const issued = await issueGiftCardsAction({
      amountRupees: 350,
      redeemBy: futureIstDateString(15),
      quantity: 1,
      note: "m1test parallel",
    });
    const code = issued.cards[0].code;

    const settled = await Promise.allSettled(Array.from({ length: 10 }, () => redeemGiftCardAction(code))); const fulfilled = settled.flatMap((s) => (s.status === "fulfilled" ? [s.value] : [])); const rejected = settled.flatMap((s) => (s.status === "rejected" ? [s.reason as { code?: string }] : [])); expect(fulfilled.length + rejected.length).toBe(10); expect(fulfilled.filter((r) => r.ok)).toHaveLength(1); for (const f of fulfilled.filter((r) => !r.ok)) { expect(f).toEqual({ ok: false, error: GENERIC_MSG }); } for (const r of rejected) { expect(r.code).toBe("P2028"); }

    const bal = await getWalletBalance(prisma, customer.id);
    expect(bal).toBe(35000);
  });

  it("cannot void an already redeemed card and enforces amount/redeemBy limits", async () => {
    const owner = await createTestUser({ role: "OWNER" });
    const customer = await createTestUser({ role: "CUSTOMER" });
    mockRequireRole.mockResolvedValue(owner);
    mockRequireUser.mockResolvedValue(customer);

    const issued = await issueGiftCardsAction({
      amountRupees: 100,
      redeemBy: futureIstDateString(5),
      quantity: 1,
      note: "m1test redeem then void",
    });

    const redeemRes = await redeemGiftCardAction(issued.cards[0].code);
    expect(redeemRes.ok).toBe(true);

    await expect(voidGiftCardAction(issued.cards[0].id)).rejects.toThrow();

    // Amount cap & validation
    await expect(
      issueGiftCardsAction({
        amountRupees: 0,
        redeemBy: futureIstDateString(5),
        quantity: 1,
      })
    ).rejects.toThrow();

    await expect(
      issueGiftCardsAction({
        amountRupees: 10000, // ₹10,000 > default maxAdminAdjustPaise ₹5,000
        redeemBy: futureIstDateString(5),
        quantity: 1,
      })
    ).rejects.toThrow();

    // Past redeemBy rejected
    await expect(
      issueGiftCardsAction({
        amountRupees: 100,
        redeemBy: futureIstDateString(-2),
        quantity: 1,
      })
    ).rejects.toThrow();

    // > 3 years ahead rejected
    await expect(
      issueGiftCardsAction({
        amountRupees: 100,
        redeemBy: futureIstDateString(3 * 365 + 5),
        quantity: 1,
      })
    ).rejects.toThrow();

    const list = await listGiftCards();
    expect(list.outstandingLiabilityPaise).toBeGreaterThanOrEqual(0);
  });
});
