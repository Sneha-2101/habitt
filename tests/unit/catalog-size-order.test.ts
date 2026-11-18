import { describe, it, expect } from "vitest";
import { sortSizes } from "@/lib/catalog/categories";

describe("catalog sortSizes order helper", () => {
  const seededCategorySizes = ["S", "M", "L", "XL", "XXL"];

  it("returns S, M, L, XL, XXL for seeded category order given variants in L, M, S, XXL, XL order", () => {
    const inputVariants = ["L", "M", "S", "XXL", "XL"];
    const sorted = sortSizes(inputVariants, seededCategorySizes);
    expect(sorted).toEqual(["S", "M", "L", "XL", "XXL"]);
  });

  it("puts unknown sizes last in alphabetical order", () => {
    const inputVariants = ["XL", "CUSTOM_B", "M", "CUSTOM_A", "S"];
    const sorted = sortSizes(inputVariants, seededCategorySizes);
    expect(sorted).toEqual(["S", "M", "XL", "CUSTOM_A", "CUSTOM_B"]);
  });
});
