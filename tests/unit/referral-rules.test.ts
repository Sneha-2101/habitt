import { describe, it, expect } from "vitest";
import {
  evaluateRefereeEligibility,
  evaluateReferrerRelease,
  generateReferralCode,
  normalizeEmail,
  normalizePhone,
  REFERRAL_CODE_ALPHABET,
  REFERRAL_CODE_LENGTH,
} from "@/lib/rewards/referral";

describe("rewards/referral", () => {
  it("normalizes email and phone correctly", () => {
    expect(normalizeEmail("  User@Example.COM ")).toBe("user@example.com");
    expect(normalizeEmail("")).toBeNull();
    expect(normalizePhone("+91 98765-43210")).toBe("9876543210");
    expect(normalizePhone("09876543210")).toBe("9876543210");
    expect(normalizePhone("12345")).toBeNull();
  });

  it("generates 8-char codes using only unambiguous uppercase alphabet", () => {
    const code = generateReferralCode();
    expect(code).toHaveLength(REFERRAL_CODE_LENGTH);
    for (const ch of code) {
      expect(REFERRAL_CODE_ALPHABET).toContain(ch);
      expect("0O1IL").not.toContain(ch);
    }
  });

  it("evaluates all referee eligibility failure reasons and success", () => {
    const now = new Date("2026-06-01T00:00:00.000Z");
    const baseInput = {
      referrer: { id: "u1", status: "ACTIVE", email: "ref@test.com", phone: "9999999999" },
      referee: {
        id: "u2",
        email: "fri@test.com",
        phone: "8888888888",
        emailVerifiedAt: now,
        phoneVerifiedAt: now,
        hasExistingOrders: false,
        hasExistingReferral: false,
      },
      existingClaims: [],
      settings: { referralEnabled: true },
      now,
    };

    expect(evaluateRefereeEligibility(baseInput)).toEqual({ ok: true });
    expect(
      evaluateRefereeEligibility({ ...baseInput, settings: { referralEnabled: false } })
    ).toEqual({ ok: false, reason: "DISABLED" });
    expect(
      evaluateRefereeEligibility({
        ...baseInput,
        referrer: { ...baseInput.referrer, status: "SUSPENDED" },
      })
    ).toEqual({ ok: false, reason: "REFERRER_INACTIVE" });
    expect(
      evaluateRefereeEligibility({
        ...baseInput,
        referee: { ...baseInput.referee, id: "u1" },
      })
    ).toEqual({ ok: false, reason: "SELF_REFERRAL" });
    expect(
      evaluateRefereeEligibility({
        ...baseInput,
        referee: { ...baseInput.referee, phone: "+919999999999" },
      })
    ).toEqual({ ok: false, reason: "SELF_REFERRAL" });
    expect(
      evaluateRefereeEligibility({
        ...baseInput,
        existingClaims: [{ normalizedEmail: "fri@test.com", normalizedPhone: null }],
      })
    ).toEqual({ ok: false, reason: "DUPLICATE_IDENTITY" });
    expect(
      evaluateRefereeEligibility({
        ...baseInput,
        referee: { ...baseInput.referee, hasExistingOrders: true },
      })
    ).toEqual({ ok: false, reason: "NOT_NEW_ACCOUNT" });
    expect(
      evaluateRefereeEligibility({
        ...baseInput,
        referee: { ...baseInput.referee, phoneVerifiedAt: null },
      })
    ).toEqual({ ok: false, reason: "NOT_VERIFIED" });
  });

  it("evaluates referrer release wait, reject, and release decisions", () => {
    const now = new Date("2026-06-20T00:00:00.000Z");
    const deliveredPast = new Date("2026-06-10T00:00:00.000Z");
    const deliveredRecent = new Date("2026-06-18T00:00:00.000Z");
    const futureExpiry = new Date("2026-09-01T00:00:00.000Z");

    const base = {
      referral: { expiresAt: futureExpiry },
      firstOrder: {
        fulfilmentStatus: "DELIVERED",
        paymentStatus: "PAID",
        deliveredAt: deliveredPast,
        goodsNetPaise: 100000,
        hasOpenReturn: false,
      },
      settings: {
        referralEnabled: true,
        returnWindowDays: 7,
        referralMinOrderPaise: 50000,
        referralMonthlyCapPerReferrer: 10,
      },
      now,
      monthlyRewardedCount: 0,
      refundedGoodsPaise: 0,
    };

    expect(evaluateReferrerRelease(base)).toEqual({ action: "release" });
    expect(
      evaluateReferrerRelease({
        ...base,
        firstOrder: { ...base.firstOrder, deliveredAt: deliveredRecent },
      })
    ).toEqual({ action: "wait" });
    expect(
      evaluateReferrerRelease({
        ...base,
        firstOrder: { ...base.firstOrder, hasOpenReturn: true },
      })
    ).toEqual({ action: "wait" });
    expect(
      evaluateReferrerRelease({
        ...base,
        refundedGoodsPaise: 100000,
      })
    ).toEqual({ action: "reject", reason: "FIRST_ORDER_RETURNED" });
    expect(
      evaluateReferrerRelease({
        ...base,
        monthlyRewardedCount: 10,
      })
    ).toEqual({ action: "reject", reason: "MONTHLY_CAP_REACHED" });
    expect(
      evaluateReferrerRelease({
        ...base,
        referral: { expiresAt: new Date("2026-06-01T00:00:00.000Z") },
      })
    ).toEqual({ action: "reject", reason: "EXPIRED" });
  });
});
