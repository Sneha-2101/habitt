import { describe, it, expect } from "vitest";
import {
  GIFT_CARD_ALPHABET,
  GIFT_CARD_CODE_LENGTH,
  generateGiftCardCode,
  getCodeLast4,
  hashCode,
  normalizeCode,
} from "@/lib/gift-cards/code";

describe("gift-card code helpers", () => {
  it("uses the unambiguous 31-char alphabet without I, L, O, 0, 1", () => {
    expect(GIFT_CARD_ALPHABET).toBe("ABCDEFGHJKMNPQRSTUVWXYZ23456789");
    expect(GIFT_CARD_ALPHABET).toHaveLength(31);
    for (const excluded of ["I", "L", "O", "0", "1"]) {
      expect(GIFT_CARD_ALPHABET).not.toContain(excluded);
    }
  });

  it("generates codes in GC-XXXX-XXXX-XXXX format with length 12 payload", () => {
    const code = generateGiftCardCode();
    expect(code).toMatch(/^GC-[A-HJ-KM-NP-Z2-9]{4}-[A-HJ-KM-NP-Z2-9]{4}-[A-HJ-KM-NP-Z2-9]{4}$/);
    const norm = normalizeCode(code);
    expect(norm).not.toBeNull();
    expect(norm).toHaveLength(GIFT_CARD_CODE_LENGTH);
  });

  it("normalizeCode accepts lowercase, spaces, hyphens, and optional GC prefix", () => {
    const expected = "ABCDEFGHJKMN";
    expect(normalizeCode("GC-ABCD-EFGH-JKMN")).toBe(expected);
    expect(normalizeCode("  gc abcd efgh jkmn  ")).toBe(expected);
    expect(normalizeCode("abcd-efgh-jkmn")).toBe(expected);
    expect(normalizeCode("abcdefghjkmn")).toBe(expected);
    expect(normalizeCode("gC-aBcD efGh-JkMn")).toBe(expected);
  });

  it("normalizeCode rejects wrong lengths and invalid characters", () => {
    expect(normalizeCode("")).toBeNull();
    expect(normalizeCode("GC-ABCD-EFGH-JKM")).toBeNull();
    expect(normalizeCode("GC-ABCD-EFGH-JKMNP")).toBeNull();
    expect(normalizeCode("GC-ABCD-EFGH-JKMI")).toBeNull(); // I
    expect(normalizeCode("GC-ABCD-EFGH-JKML")).toBeNull(); // L
    expect(normalizeCode("GC-ABCD-EFGH-JKMO")).toBeNull(); // O
    expect(normalizeCode("GC-ABCD-EFGH-JKM0")).toBeNull(); // 0
    expect(normalizeCode("GC-ABCD-EFGH-JKM1")).toBeNull(); // 1
    expect(normalizeCode("GC-ABCD-EFGH-JKM!")).toBeNull();
  });

  it("hashCode is stable SHA-256 hex and getCodeLast4 returns last 4 chars", () => {
    const norm = "ABCDEFGHJKMN";
    const h1 = hashCode(norm);
    const h2 = hashCode(norm);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[a-f0-9]{64}$/);
    expect(h1).not.toContain(norm);
    expect(getCodeLast4(norm)).toBe("JKMN");
  });

  it("generates 1000 valid and unique codes", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i += 1) {
      const code = generateGiftCardCode();
      const norm = normalizeCode(code);
      expect(norm).not.toBeNull();
      expect(code).toMatch(/^GC-[A-HJ-KM-NP-Z2-9]{4}-[A-HJ-KM-NP-Z2-9]{4}-[A-HJ-KM-NP-Z2-9]{4}$/);
      seen.add(norm!);
    }
    expect(seen.size).toBe(1000);
  });
});
