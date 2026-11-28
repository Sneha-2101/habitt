import { describe, it, expect } from "vitest";
import { isLotEligibleForExpiryWarning, WALLET_EXPIRY_WARNING_DAYS } from "@/lib/wallet/service";
import { buildWalletExpiryWarningEmailHtml, formatIstDate } from "@/lib/email";

describe("wallet/expiry-warning helpers", () => {
  it("uses a 7-day warning window", () => {
    expect(WALLET_EXPIRY_WARNING_DAYS).toBe(7);
  });

  it("filters eligible lots for 7-day expiry warning", () => {
    const now = new Date("2026-11-28T00:00:00.000Z");
    const in3Days = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
    const in10Days = new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000);
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    expect(
      isLotEligibleForExpiryWarning({ remainingPaise: 5000, kind: "PROMO", expiresAt: in3Days }, now)
    ).toBe(true);
    expect(
      isLotEligibleForExpiryWarning({ remainingPaise: 5000, kind: "PROMO", expiresAt: in10Days }, now)
    ).toBe(false);
    expect(
      isLotEligibleForExpiryWarning({ remainingPaise: 5000, kind: "PROMO", expiresAt: yesterday }, now)
    ).toBe(false);
    expect(
      isLotEligibleForExpiryWarning({ remainingPaise: 5000, kind: "PROMO", expiresAt: null }, now)
    ).toBe(false);
    expect(
      isLotEligibleForExpiryWarning({ remainingPaise: 5000, kind: "REFUND", expiresAt: in3Days }, now)
    ).toBe(false);
    expect(
      isLotEligibleForExpiryWarning({ remainingPaise: 0, kind: "PROMO", expiresAt: in3Days }, now)
    ).toBe(false);
  });

  it("renders escaped HTML email with IST date, amount, wallet link, and business name", () => {
    const expiresAt = new Date("2026-12-05T18:30:00.000Z"); // 6 Dec 2026 in IST
    expect(formatIstDate(expiresAt)).toContain("Dec");
    expect(formatIstDate(expiresAt)).toContain("2026");

    const html = buildWalletExpiryWarningEmailHtml({
      amountPaise: 25000,
      expiresAt,
      businessName: 'Habitt <script>alert("xss")</script>',
      tagline: "Craft & Care",
      walletUrl: "https://example.com/account/wallet",
    });

    expect(html).toContain("₹250.00");
    expect(html).toContain("https://example.com/account/wallet");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain("(IST)");
  });
});
