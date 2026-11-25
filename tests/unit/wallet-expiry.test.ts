import { describe, it, expect } from "vitest";
import { computeExpiresAt, WALLET_RESTORE_GRACE_DAYS } from "@/lib/wallet/allocate";

describe("wallet/expiry", () => {
  it("exports WALLET_RESTORE_GRACE_DAYS = 7", () => {
    expect(WALLET_RESTORE_GRACE_DAYS).toBe(7);
  });

  it("computes expiresAt for PROMO using promoDays and returns null for REFUND/ADJUST", () => {
    const now = new Date("2026-06-01T00:00:00.000Z");

    const promo180 = computeExpiresAt("PROMO_CAMPAIGN", "PROMO", now, 180);
    expect(promo180).toEqual(new Date(now.getTime() + 180 * 24 * 60 * 60 * 1000));

    const promo30 = computeExpiresAt(null, "PROMO", now, 30);
    expect(promo30).toEqual(new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000));

    expect(computeExpiresAt("REFUND", "REFUND", now, 180)).toBeNull();
    expect(computeExpiresAt("ADMIN", "ADJUST", now, 180)).toBeNull();
  });
});
