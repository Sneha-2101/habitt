import { describe, it, expect } from "vitest";
import {
  productFieldsSchema,
  toProductFieldData,
  validateCompareAtAgainstPrice,
} from "@/lib/catalog/product-fields";

describe("productFieldsSchema", () => {
  it("parses valid fields cleanly", () => {
    const input = {
      price: 1000,
      compareAtRupees: 1500,
      costRupees: 600,
      hsn: "6205",
      fabric: "100% Cotton",
      fit: "Regular",
      care: "Machine wash cold",
      sizeChartUrl: "https://example.com/chart",
      seoTitle: "Classic Cotton Shirt",
      seoDescription: "A premium cotton shirt for everyday wear.",
    };

    const parsed = productFieldsSchema.parse(input);
    expect(parsed.compareAtRupees).toBe(1500);
    expect(parsed.costRupees).toBe(600);
    expect(parsed.hsn).toBe("6205");
    expect(parsed.fabric).toBe("100% Cotton");
    expect(parsed.fit).toBe("Regular");
    expect(parsed.care).toBe("Machine wash cold");
    expect(parsed.sizeChartUrl).toBe("https://example.com/chart");
    expect(parsed.seoTitle).toBe("Classic Cotton Shirt");
    expect(parsed.seoDescription).toBe("A premium cotton shirt for everyday wear.");
  });

  it("handles string representations and trims empty strings to null", () => {
    const input = {
      price: "1000",
      compareAtRupees: "  1500  ",
      costRupees: " 0 ",
      hsn: "  ",
      fabric: "  ",
      fit: "",
      care: " ",
      sizeChartUrl: "",
      seoTitle: "",
      seoDescription: "",
    };

    const parsed = productFieldsSchema.parse(input);
    expect(parsed.compareAtRupees).toBe(1500);
    expect(parsed.costRupees).toBe(0);
    expect(parsed.hsn).toBeNull();
    expect(parsed.fabric).toBeNull();
    expect(parsed.fit).toBeNull();
    expect(parsed.care).toBeNull();
    expect(parsed.sizeChartUrl).toBeNull();
    expect(parsed.seoTitle).toBeNull();
    expect(parsed.seoDescription).toBeNull();
  });

  it("rejects compareAtRupees <= price when both are present", () => {
    expect(() =>
      productFieldsSchema.parse({
        price: 1000,
        compareAtRupees: 1000,
      })
    ).toThrow(/Compare-at price must be greater than/i);

    expect(() =>
      productFieldsSchema.parse({
        price: 1000,
        compareAtRupees: 800,
      })
    ).toThrow(/Compare-at price must be greater than/i);
  });

  it("allows compareAtRupees when price is not provided in schema", () => {
    const parsed = productFieldsSchema.parse({
      compareAtRupees: 1200,
    });
    expect(parsed.compareAtRupees).toBe(1200);
  });

  it("rejects negative or 0 compareAtRupees", () => {
    expect(() =>
      productFieldsSchema.parse({
        compareAtRupees: 0,
      })
    ).toThrow();

    expect(() =>
      productFieldsSchema.parse({
        compareAtRupees: -50,
      })
    ).toThrow();
  });

  it("rejects negative costRupees but allows 0", () => {
    const parsedZero = productFieldsSchema.parse({ costRupees: 0 });
    expect(parsedZero.costRupees).toBe(0);

    expect(() =>
      productFieldsSchema.parse({
        costRupees: -1,
      })
    ).toThrow();
  });

  it("rejects prices exceeding 10,000,000", () => {
    expect(() =>
      productFieldsSchema.parse({
        compareAtRupees: 10_000_001,
      })
    ).toThrow();

    expect(() =>
      productFieldsSchema.parse({
        costRupees: 10_000_001,
      })
    ).toThrow();
  });

  it("validates HSN code lengths: accepts 4, 6, 8 digits, rejects others", () => {
    expect(productFieldsSchema.parse({ hsn: "1234" }).hsn).toBe("1234");
    expect(productFieldsSchema.parse({ hsn: "123456" }).hsn).toBe("123456");
    expect(productFieldsSchema.parse({ hsn: "12345678" }).hsn).toBe("12345678");

    expect(() => productFieldsSchema.parse({ hsn: "123" })).toThrow(/HSN/);
    expect(() => productFieldsSchema.parse({ hsn: "12345" })).toThrow(/HSN/);
    expect(() => productFieldsSchema.parse({ hsn: "1234567" })).toThrow(/HSN/);
    expect(() => productFieldsSchema.parse({ hsn: "123456789" })).toThrow(/HSN/);
    expect(() => productFieldsSchema.parse({ hsn: "abcd" })).toThrow(/HSN/);
  });

  it("validates sizeChartUrl rules: https:// or single '/', no spaces, max 500 chars", () => {
    expect(
      productFieldsSchema.parse({ sizeChartUrl: "https://habitt.in/size-guide" }).sizeChartUrl
    ).toBe("https://habitt.in/size-guide");
    expect(productFieldsSchema.parse({ sizeChartUrl: "/size-guide" }).sizeChartUrl).toBe(
      "/size-guide"
    );

    // Rejects protocol-relative //
    expect(() => productFieldsSchema.parse({ sizeChartUrl: "//evil.com" })).toThrow();
    // Rejects http://
    expect(() => productFieldsSchema.parse({ sizeChartUrl: "http://example.com" })).toThrow();
    // Rejects spaces
    expect(() => productFieldsSchema.parse({ sizeChartUrl: "https://example.com/size guide" })).toThrow();
    // Rejects length > 500
    const longUrl = "https://example.com/" + "a".repeat(500);
    expect(() => productFieldsSchema.parse({ sizeChartUrl: longUrl })).toThrow();
  });

  it("enforces length limits on text fields", () => {
    expect(() => productFieldsSchema.parse({ fabric: "a".repeat(121) })).toThrow();
    expect(() => productFieldsSchema.parse({ fit: "a".repeat(121) })).toThrow();
    expect(() => productFieldsSchema.parse({ care: "a".repeat(1001) })).toThrow();
    expect(() => productFieldsSchema.parse({ seoTitle: "a".repeat(71) })).toThrow();
    expect(() => productFieldsSchema.parse({ seoDescription: "a".repeat(161) })).toThrow();
  });
});

describe("toProductFieldData helper", () => {
  it("converts rupees to paise and preserves nulls", () => {
    const data = toProductFieldData({
      compareAtRupees: 1999.5,
      costRupees: 850.25,
      hsn: "6205",
      fabric: "Linen",
      fit: "Relaxed",
      care: "Dry clean only",
      sizeChartUrl: "/charts/shirts",
      seoTitle: "Relaxed Linen Shirt",
      seoDescription: "Handcrafted linen shirt",
    });

    expect(data.compareAtPrice).toBe(199950);
    expect(data.costPrice).toBe(85025);
    expect(data.hsn).toBe("6205");
    expect(data.fabric).toBe("Linen");
    expect(data.fit).toBe("Relaxed");
    expect(data.care).toBe("Dry clean only");
    expect(data.sizeChartUrl).toBe("/charts/shirts");
    expect(data.seoTitle).toBe("Relaxed Linen Shirt");
    expect(data.seoDescription).toBe("Handcrafted linen shirt");
  });

  it("handles null / undefined rupee values", () => {
    const data = toProductFieldData({
      compareAtRupees: null,
      costRupees: null,
      hsn: "",
      fabric: "",
    });

    expect(data.compareAtPrice).toBeNull();
    expect(data.costPrice).toBeNull();
    expect(data.hsn).toBeNull();
    expect(data.fabric).toBeNull();
  });

  it("does not include costPrice when costRupees is undefined and includeCost is omitted or when includeCost is false", () => {
    const dataStaff = toProductFieldData(
      {
        compareAtRupees: 2000,
      },
      { includeCost: false }
    );
    expect(dataStaff.costPrice).toBeUndefined();
    expect(dataStaff.compareAtPrice).toBe(200000);
  });
});

describe("validateCompareAtAgainstPrice", () => {
  it("returns true when compareAt is null or undefined", () => {
    expect(validateCompareAtAgainstPrice(100000, null)).toBe(true);
    expect(validateCompareAtAgainstPrice(100000, undefined)).toBe(true);
  });

  it("returns true when compareAt > price", () => {
    expect(validateCompareAtAgainstPrice(100000, 150000)).toBe(true);
  });

  it("returns false when compareAt <= price", () => {
    expect(validateCompareAtAgainstPrice(100000, 100000)).toBe(false);
    expect(validateCompareAtAgainstPrice(100000, 80000)).toBe(false);
  });
});
