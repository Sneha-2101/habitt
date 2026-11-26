import { describe, it, expect } from "vitest";
import { parseConsent, shouldLoadPixel, purchaseDedupeKey } from "@/lib/consent/consent";

describe("consent/consent", () => {
  it("parseConsent returns granted only when habitt_consent=granted is present", () => {
    expect(parseConsent(null)).toBe("unset");
    expect(parseConsent("")).toBe("unset");
    expect(parseConsent("foo=bar; habitt_consent=denied")).toBe("unset");
    expect(parseConsent("foo=bar; habitt_consent=granted; baz=1")).toBe("granted");
  });

  it("shouldLoadPixel requires non-empty pixelId and granted consent", () => {
    expect(shouldLoadPixel({ pixelId: "", consent: "granted" })).toBe(false);
    expect(shouldLoadPixel({ pixelId: null, consent: "granted" })).toBe(false);
    expect(shouldLoadPixel({ pixelId: "YOUR_META_PIXEL_ID", consent: "granted" })).toBe(false);
    expect(shouldLoadPixel({ pixelId: "123456789", consent: "unset" })).toBe(false);
    expect(shouldLoadPixel({ pixelId: "123456789", consent: "granted" })).toBe(true);
  });

  it("purchaseDedupeKey is stable per orderId", () => {
    expect(purchaseDedupeKey("ord_123")).toBe("habitt_pixel_purchase_ord_123");
    expect(purchaseDedupeKey("ord_123")).toBe(purchaseDedupeKey("ord_123"));
    expect(purchaseDedupeKey("ord_456")).not.toBe(purchaseDedupeKey("ord_123"));
  });
});
