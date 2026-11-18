import { describe, it, expect } from "vitest";
import { categoryInputSchema, sortSizes, isSizeAllowed } from "@/lib/catalog/categories";

describe("Category Catalog Module Unit Tests", () => {
  describe("categoryInputSchema validation", () => {
    it("accepts valid category input", () => {
      const input = {
        slug: "linen-shirts",
        name: "Linen Shirts",
        sizes: ["S", "M", "L", "XL"],
        position: 10,
        active: true,
      };
      const parsed = categoryInputSchema.parse(input);
      expect(parsed.slug).toBe("linen-shirts");
      expect(parsed.name).toBe("Linen Shirts");
      expect(parsed.sizes).toEqual(["S", "M", "L", "XL"]);
      expect(parsed.position).toBe(10);
      expect(parsed.active).toBe(true);
    });

    it("rejects bad slug (uppercase, special characters, too short, too long)", () => {
      expect(() => categoryInputSchema.parse({
        slug: "Linen-Shirts",
        name: "Shirts",
        sizes: ["M"],
      })).toThrow();

      expect(() => categoryInputSchema.parse({
        slug: "linen_shirts",
        name: "Shirts",
        sizes: ["M"],
      })).toThrow();

      expect(() => categoryInputSchema.parse({
        slug: "a",
        name: "Shirts",
        sizes: ["M"],
      })).toThrow();

      expect(() => categoryInputSchema.parse({
        slug: "a".repeat(41),
        name: "Shirts",
        sizes: ["M"],
      })).toThrow();
    });

    it("rejects duplicate sizes ignoring case", () => {
      expect(() => categoryInputSchema.parse({
        slug: "shirts",
        name: "Shirts",
        sizes: ["S", "s"],
      })).toThrow(/unique/i);

      expect(() => categoryInputSchema.parse({
        slug: "shirts",
        name: "Shirts",
        sizes: ["Medium", "medium"],
      })).toThrow(/unique/i);
    });

    it("rejects empty size string or empty sizes array", () => {
      expect(() => categoryInputSchema.parse({
        slug: "shirts",
        name: "Shirts",
        sizes: [""],
      })).toThrow();

      expect(() => categoryInputSchema.parse({
        slug: "shirts",
        name: "Shirts",
        sizes: ["   "],
      })).toThrow();

      expect(() => categoryInputSchema.parse({
        slug: "shirts",
        name: "Shirts",
        sizes: [],
      })).toThrow();
    });

    it("rejects 16 sizes (max 15 allowed)", () => {
      const sixteen = Array.from({ length: 16 }, (_, i) => `SZ${i + 1}`);
      expect(() => categoryInputSchema.parse({
        slug: "shirts",
        name: "Shirts",
        sizes: sixteen,
      })).toThrow(/more than 15/i);
    });

    it("rejects comma in size", () => {
      expect(() => categoryInputSchema.parse({
        slug: "shirts",
        name: "Shirts",
        sizes: ["M,L"],
      })).toThrow(/comma/i);
    });
  });

  describe("sortSizes helper", () => {
    it("orders variant sizes according to category sizes, and puts unknown sizes after in alphabetical order", () => {
      const categorySizes = ["S", "M", "L", "XL", "XXL"];
      const variantSizes = ["Custom-B", "XL", "S", "Custom-A", "M"];
      const sorted = sortSizes(variantSizes, categorySizes);
      expect(sorted).toEqual(["S", "M", "XL", "Custom-A", "Custom-B"]);
    });

    it("handles all unknown sizes alphabetically", () => {
      const categorySizes = ["S", "M"];
      const variantSizes = ["Z", "B", "A"];
      expect(sortSizes(variantSizes, categorySizes)).toEqual(["A", "B", "Z"]);
    });

    it("handles all known sizes in category order", () => {
      const categorySizes = ["XS", "S", "M", "L"];
      const variantSizes = ["L", "XS", "M"];
      expect(sortSizes(variantSizes, categorySizes)).toEqual(["XS", "M", "L"]);
    });

    it("handles empty arrays cleanly", () => {
      expect(sortSizes([], ["S", "M"])).toEqual([]);
      expect(sortSizes(["M", "S"], [])).toEqual(["M", "S"]); // alphabetical: M before S
    });
  });

  describe("isSizeAllowed helper", () => {
    it("returns true for allowed size and false for disallowed", () => {
      const categorySizes = ["S", "M", "L", "XL"];
      expect(isSizeAllowed("M", categorySizes)).toBe(true);
      expect(isSizeAllowed("XXL", categorySizes)).toBe(false);
      expect(isSizeAllowed("m", categorySizes)).toBe(false);
    });
  });
});
