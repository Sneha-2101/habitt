import { describe, it, expect } from "vitest";
import { savingsPaise, savingsPercent } from "@/lib/catalog/pricing-display";

describe("savingsPaise", () => {
  it("returns null when compareAt is missing, null, undefined, or NaN", () => {
    expect(savingsPaise(1000, null)).toBeNull();
    expect(savingsPaise(1000, undefined)).toBeNull();
    expect(savingsPaise(1000, NaN)).toBeNull();
    expect(savingsPaise(null, 1500)).toBeNull();
    expect(savingsPaise(undefined, 1500)).toBeNull();
    expect(savingsPaise(NaN, 1500)).toBeNull();
  });

  it("returns null when compareAt <= price", () => {
    expect(savingsPaise(1000, 1000)).toBeNull();
    expect(savingsPaise(1000, 800)).toBeNull();
    expect(savingsPaise(150000, 150000)).toBeNull();
    expect(savingsPaise(200000, 100000)).toBeNull();
  });

  it("returns the difference when compareAt > price", () => {
    expect(savingsPaise(1000, 1500)).toBe(500);
    expect(savingsPaise(80000, 120000)).toBe(40000);
    expect(savingsPaise(199900, 249900)).toBe(50000);
  });
});

describe("savingsPercent", () => {
  it("returns null for invalid or non-discounted inputs", () => {
    expect(savingsPercent(1000, null)).toBeNull();
    expect(savingsPercent(1000, undefined)).toBeNull();
    expect(savingsPercent(1000, 1000)).toBeNull();
    expect(savingsPercent(1200, 1000)).toBeNull();
    expect(savingsPercent(null, 1500)).toBeNull();
  });

  it("returns an integer percent with floor rounding", () => {
    // 200 / 1000 = 20%
    expect(savingsPercent(800, 1000)).toBe(20);

    // 250 / 1000 = 25%
    expect(savingsPercent(750, 1000)).toBe(25);

    // 100 / 300 = 33.333% -> floor is 33
    expect(savingsPercent(200, 300)).toBe(33);

    // 1 / 3 = 33.333%
    expect(savingsPercent(2, 3)).toBe(33);

    // 99 / 100 = 1%
    expect(savingsPercent(99, 100)).toBe(1);

    // 1 / 1000 = 0.1% -> floor is 0
    expect(savingsPercent(999, 1000)).toBe(0);
  });
});
