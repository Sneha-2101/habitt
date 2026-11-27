import { describe, it, expect } from "vitest";
import { normalizeInfluencerCode, parseAttributionCookie } from "@/lib/influencers/code";

describe("influencers/code", () => {
  it("normalizes trim, uppercase, and internal spaces", () => {
    expect(normalizeInfluencerCode("  aarav 10 ")).toBe("AARAV10");
    expect(normalizeInfluencerCode("maya_style-26")).toBe("MAYA_STYLE-26");
  });

  it("returns null for empty, invalid chars, too short, or too long", () => {
    expect(normalizeInfluencerCode("")).toBeNull();
    expect(normalizeInfluencerCode("   ")).toBeNull();
    expect(normalizeInfluencerCode(null)).toBeNull();
    expect(normalizeInfluencerCode("AB")).toBeNull(); // < 3
    expect(normalizeInfluencerCode("A".repeat(33))).toBeNull(); // > 32
    expect(normalizeInfluencerCode("-ABC")).toBeNull(); // must start with A-Z0-9
    expect(normalizeInfluencerCode("AB%C")).toBeNull();
  });

  it("parseAttributionCookie normalizes valid cookie values and rejects invalid", () => {
    expect(parseAttributionCookie("aarav10")).toBe("AARAV10");
    expect(parseAttributionCookie("%%%")).toBeNull();
    expect(parseAttributionCookie(undefined)).toBeNull();
  });
});
