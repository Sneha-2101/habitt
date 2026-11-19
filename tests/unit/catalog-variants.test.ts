import { describe, it, expect } from "vitest";
import {
  colorInputSchema,
  skuSchema,
  groupVariants,
  pickDefaultVariant,
} from "@/lib/catalog/variants";

describe("lib/catalog/variants", () => {
  describe("colorInputSchema", () => {
    it("accepts valid color names and normalises hex", () => {
      const parsed = colorInputSchema.parse({
        name: "  Navy Blue  ",
        hex: "  #1a2b3c  ",
      });
      expect(parsed).toEqual({
        name: "Navy Blue",
        hex: "#1A2B3C",
      });
    });

    it("normalises empty/whitespace/null hex to null", () => {
      expect(colorInputSchema.parse({ name: "Black", hex: "" }).hex).toBeNull();
      expect(colorInputSchema.parse({ name: "Black", hex: "   " }).hex).toBeNull();
      expect(colorInputSchema.parse({ name: "Black", hex: null }).hex).toBeNull();
      expect(colorInputSchema.parse({ name: "Black" }).hex).toBeNull();
    });

    it("rejects empty name or name > 30 chars", () => {
      expect(() => colorInputSchema.parse({ name: "" })).toThrow();
      expect(() => colorInputSchema.parse({ name: "   " })).toThrow();
      expect(() => colorInputSchema.parse({ name: "a".repeat(31) })).toThrow();
    });

    it("rejects control characters in color name", () => {
      expect(() => colorInputSchema.parse({ name: "Navy\u0000" })).toThrow("control characters");
      expect(() => colorInputSchema.parse({ name: "Olive\nGreen" })).toThrow("control characters");
      expect(() => colorInputSchema.parse({ name: "Tab\tColor" })).toThrow("control characters");
    });

    it("rejects pipe '|' character in color name", () => {
      expect(() => colorInputSchema.parse({ name: "Red | Blue" })).toThrow("'|'");
    });

    it("rejects invalid hex formats", () => {
      expect(() => colorInputSchema.parse({ name: "Red", hex: "red" })).toThrow();
      expect(() => colorInputSchema.parse({ name: "Red", hex: "#FFF" })).toThrow();
      expect(() => colorInputSchema.parse({ name: "Red", hex: "#1234567" })).toThrow();
      expect(() => colorInputSchema.parse({ name: "Red", hex: "#GGGGGG" })).toThrow();
    });
  });

  describe("skuSchema", () => {
    it("accepts valid SKUs and normalises to uppercase and trims", () => {
      expect(skuSchema.parse("  hab-tee-01  ")).toBe("HAB-TEE-01");
      expect(skuSchema.parse("sku.123_a-b")).toBe("SKU.123_A-B");
      expect(skuSchema.parse("ABC")).toBe("ABC");
    });

    it("normalises empty/whitespace/null/undefined to null", () => {
      expect(skuSchema.parse("")).toBeNull();
      expect(skuSchema.parse("   ")).toBeNull();
      expect(skuSchema.parse(null)).toBeNull();
      expect(skuSchema.parse(undefined)).toBeNull();
    });

    it("rejects SKU shorter than 3 or longer than 40 chars", () => {
      expect(() => skuSchema.parse("AB")).toThrow();
      expect(() => skuSchema.parse("A".repeat(41))).toThrow();
    });

    it("rejects SKU with invalid characters or invalid starting character", () => {
      expect(() => skuSchema.parse("-SKU123")).toThrow();
      expect(() => skuSchema.parse("_SKU123")).toThrow();
      expect(() => skuSchema.parse(".SKU123")).toThrow();
      expect(() => skuSchema.parse("SKU 123")).toThrow();
      expect(() => skuSchema.parse("SKU@123")).toThrow();
    });
  });

  describe("groupVariants", () => {
    const categorySizes = ["S", "M", "L", "XL", "XXL"];

    it("handles products with no colors (hasColors false and sizes in category order)", () => {
      const variants = [
        { id: "v_l", size: "L", color: "", stock: 5 },
        { id: "v_s", size: "S", color: "", stock: 2 },
        { id: "v_m", size: "M", color: "", stock: 0 },
      ];

      const grouped = groupVariants(variants, categorySizes);
      expect(grouped.hasColors).toBe(false);
      expect(grouped.colors).toHaveLength(1);
      expect(grouped.colors[0].color).toBe("");
      expect(grouped.colors[0].inStock).toBe(true);
      expect(grouped.colors[0].sizes.map((s) => s.size)).toEqual(["S", "M", "L"]);
    });

    it("groups variants across two colors in first-appearance order with category sizes sorted", () => {
      const variants = [
        { id: "v_navy_m", size: "M", color: "Navy", colorHex: "#000080", stock: 3 },
        { id: "v_navy_s", size: "S", color: "Navy", colorHex: "#000080", stock: 0 },
        { id: "v_olive_l", size: "L", color: "Olive", colorHex: "#808000", stock: 4 },
        { id: "v_olive_s", size: "S", color: "Olive", colorHex: "#808000", stock: 1 },
      ];

      const grouped = groupVariants(variants, categorySizes);
      expect(grouped.hasColors).toBe(true);
      expect(grouped.colors).toHaveLength(2);
      expect(grouped.colors[0].color).toBe("Navy");
      expect(grouped.colors[0].colorHex).toBe("#000080");
      expect(grouped.colors[0].sizes.map((s) => s.size)).toEqual(["S", "M"]);

      expect(grouped.colors[1].color).toBe("Olive");
      expect(grouped.colors[1].colorHex).toBe("#808000");
      expect(grouped.colors[1].sizes.map((s) => s.size)).toEqual(["S", "L"]);
    });

    it("handles mixed stock and sorts unknown sizes last alphabetically", () => {
      const variants = [
        { id: "v_custom_b", size: "CUSTOM_B", color: "Black", stock: 0 },
        { id: "v_m", size: "M", color: "Black", stock: 0 },
        { id: "v_custom_a", size: "CUSTOM_A", color: "Black", stock: 2 },
        { id: "v_s", size: "S", color: "Black", stock: 5 },
      ];

      const grouped = groupVariants(variants, categorySizes);
      expect(grouped.hasColors).toBe(true);
      expect(grouped.colors[0].inStock).toBe(true);
      // Category sizes first (S, M), then unknown sizes sorted alphabetically (CUSTOM_A, CUSTOM_B)
      expect(grouped.colors[0].sizes.map((s) => s.size)).toEqual(["S", "M", "CUSTOM_A", "CUSTOM_B"]);
    });
  });

  describe("pickDefaultVariant", () => {
    it("picks first color with any stock, then its first in-stock size", () => {
      const grouped = {
        hasColors: true,
        colors: [
          {
            color: "Red",
            colorHex: "#FF0000",
            inStock: false,
            sizes: [
              { id: "v_red_s", size: "S", stock: 0 },
              { id: "v_red_m", size: "M", stock: 0 },
            ],
          },
          {
            color: "Blue",
            colorHex: "#0000FF",
            inStock: true,
            sizes: [
              { id: "v_blue_s", size: "S", stock: 0 },
              { id: "v_blue_m", size: "M", stock: 5 },
              { id: "v_blue_l", size: "L", stock: 2 },
            ],
          },
          {
            color: "Green",
            colorHex: "#00FF00",
            inStock: true,
            sizes: [{ id: "v_green_s", size: "S", stock: 10 }],
          },
        ],
      };

      const picked = pickDefaultVariant(grouped);
      expect(picked).toEqual({
        color: "Blue",
        size: "M",
        id: "v_blue_m",
        variantId: "v_blue_m",
        stock: 5,
      });
    });

    it("falls back to the first color and first size if everything is out of stock", () => {
      const grouped = {
        hasColors: true,
        colors: [
          {
            color: "Navy",
            colorHex: "#000080",
            inStock: false,
            sizes: [
              { id: "v_navy_s", size: "S", stock: 0 },
              { id: "v_navy_m", size: "M", stock: 0 },
            ],
          },
          {
            color: "Olive",
            colorHex: "#808000",
            inStock: false,
            sizes: [{ id: "v_olive_s", size: "S", stock: 0 }],
          },
        ],
      };

      const picked = pickDefaultVariant(grouped);
      expect(picked).toEqual({
        color: "Navy",
        size: "S",
        id: "v_navy_s",
        variantId: "v_navy_s",
        stock: 0,
      });
    });

    it("returns null if grouped colors is empty", () => {
      expect(pickDefaultVariant({ hasColors: false, colors: [] })).toBeNull();
    });
  });
});
