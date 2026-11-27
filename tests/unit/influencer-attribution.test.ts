import { describe, it, expect } from "vitest";
import { resolveAttribution } from "@/lib/influencers/attribution";

describe("influencers/attribution", () => {
  it("coupon wins over link when both are active", () => {
    expect(
      resolveAttribution({
        couponInfluencer: { id: "inf_coupon", active: true },
        cookieInfluencer: { id: "inf_link", active: true },
      })
    ).toEqual({ influencerId: "inf_coupon", source: "COUPON" });
  });

  it("uses link when no coupon influencer is present", () => {
    expect(
      resolveAttribution({
        couponInfluencer: null,
        cookieInfluencer: { id: "inf_link", active: true },
      })
    ).toEqual({ influencerId: "inf_link", source: "LINK" });
  });

  it("inactive coupon influencer falls through to active link influencer", () => {
    expect(
      resolveAttribution({
        couponInfluencer: { id: "inf_coupon", active: false },
        cookieInfluencer: { id: "inf_link", active: true },
      })
    ).toEqual({ influencerId: "inf_link", source: "LINK" });
  });

  it("returns null when both are inactive or missing", () => {
    expect(
      resolveAttribution({
        couponInfluencer: { id: "inf_1", active: false },
        cookieInfluencer: { id: "inf_2", active: false },
      })
    ).toBeNull();
    expect(
      resolveAttribution({
        couponInfluencer: null,
        cookieInfluencer: null,
      })
    ).toBeNull();
  });
});
