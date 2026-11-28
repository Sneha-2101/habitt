import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import crypto from "crypto";
import { prisma } from "../helpers/prisma";
import { cleanupM1TestRows, createTestUser, genId } from "../helpers/fixtures";
import { otpIdentifierKey } from "@/lib/otp-identifier";
import { resetMemoryLimits } from "@/lib/ratelimit";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));
vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue(new Headers({ "x-forwarded-for": "198.51.100.42" })),
}));
vi.mock("@/lib/turnstile", () => ({
  verifyTurnstile: vi.fn().mockResolvedValue(true),
}));
vi.mock("@/lib/otp-email", () => ({
  sendEmailOtp: vi.fn().mockResolvedValue({ success: true }),
}));

const mockRequireUser = vi.fn();
const mockRequireRole = vi.fn();
vi.mock("@/lib/guards", () => ({
  requireUser: () => mockRequireUser(),
  requireRole: (role: string) => mockRequireRole(role),
}));

import { requestOtpAction } from "@/lib/actions/otp";
import { verifyOtp } from "@/lib/otp";
import {
  issueGiftCardsAction,
  redeemGiftCardAction,
  voidGiftCardAction,
} from "@/lib/actions/gift-cards";

describe("T121: OTP identifier hashing & gift-card throttling + tx audit", () => {
  beforeEach(async () => {
    resetMemoryLimits();
    await cleanupM1TestRows();
  });

  afterEach(async () => {
    resetMemoryLimits();
    await cleanupM1TestRows();
  });

  it("stores hashed OtpCode.identifier (never plaintext) and verifyOtp returns plaintext identifier", async () => {
    const email = `${genId("m1test_otphash")}@example.test`;
    const plainCode = 654321;

    const spy = vi.spyOn(crypto, "randomInt").mockReturnValue(plainCode as never);
    const reqRes = await requestOtpAction(email, "EMAIL");
    spy.mockRestore();
    expect(reqRes.success).toBe(true);

    const plaintextRows = await prisma.otpCode.findMany({ where: { identifier: email } });
    expect(plaintextRows).toHaveLength(0);

    const hashedRows = await prisma.otpCode.findMany({
      where: { identifier: otpIdentifierKey(email) },
    });
    expect(hashedRows).toHaveLength(1);

    const wrong = await verifyOtp(email, "000000");
    expect(wrong.success).toBe(false);

    const ok = await verifyOtp(email, plainCode.toString());
    expect(ok.success).toBe(true);
    expect(ok.identifier).toBe(email);
  });

  it("blocks a valid gift card after 10 failed redeems and writes tx audits for issue/redeem/void", async () => {
    const owner = await createTestUser({
      id: genId("m1test_gc_owner"),
      email: `${genId("m1test_gc_owner")}@example.test`,
      role: "OWNER",
    });
    const customer = await createTestUser({
      id: genId("m1test_gc_cust"),
      email: `${genId("m1test_gc_cust")}@example.test`,
      role: "CUSTOMER",
    });

    mockRequireRole.mockResolvedValue({ id: owner.id, role: "OWNER" });
    mockRequireUser.mockResolvedValue({ id: customer.id, role: "CUSTOMER" });

    const redeemBy = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const { cards } = await issueGiftCardsAction({
      amountRupees: 250,
      redeemBy,
      quantity: 2,
      note: "m1test_t121",
    });
    expect(cards).toHaveLength(2);
    const [cardA, cardB] = cards;

    for (let i = 0; i < 10; i++) {
      const fail = await redeemGiftCardAction(`INVALID-CODE-${i}`);
      expect(fail.ok).toBe(false);
    }

    const blockedValid = await redeemGiftCardAction(cardA.code);
    expect(blockedValid).toEqual({
      ok: false,
      error: "Too many failed attempts. Please try again later.",
    });
    const stillIssued = await prisma.giftCard.findUniqueOrThrow({ where: { id: cardA.id } });
    expect(stillIssued.status).toBe("ISSUED");

    // Reset limits and verify redeem + void write exact tx audit rows
    resetMemoryLimits();
    const redeemed = await redeemGiftCardAction(cardA.code);
    expect(redeemed.ok).toBe(true);

    await voidGiftCardAction(cardB.id);

    const audits = await prisma.auditLog.findMany({
      where: { entityId: { in: [cardA.id, cardB.id] } },
    });
    expect(audits).toHaveLength(4); // 2 issue + 1 redeem + 1 void
    for (const a of audits) {
      const meta = a.meta as Record<string, unknown>;
      expect(Object.keys(meta).sort()).toEqual(["amountPaise", "id", "last4"]);
      expect(meta).not.toHaveProperty("code");
      expect(meta).not.toHaveProperty("codeHash");
    }
  });
});
