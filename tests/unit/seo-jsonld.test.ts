import { describe, it, expect } from "vitest";
import {
  formatInrPrice,
  serializeJsonLd,
  productJsonLd,
  organizationJsonLd,
  websiteJsonLd,
  breadcrumbJsonLd,
} from "@/lib/seo/jsonld";

describe("seo/jsonld", () => {
  it("formats paise as 2-decimal INR string", () => {
    expect(formatInrPrice(249900)).toBe("2499.00");
    expect(formatInrPrice(0)).toBe("0.00");
  });

  it("serializeJsonLd escapes script-breaking characters and omits null/undefined", () => {
    const json = serializeJsonLd({ a: "<script>&", b: undefined, c: null });
    expect(json).not.toContain("<");
    expect(json).not.toContain(">");
    expect(json).not.toContain("&");
    expect(json).not.toContain('"b"');
    expect(json).not.toContain('"c"');
  });

  it("productJsonLd emits Offer for uniform price, InStock when stock > 0, and no handlingTime", () => {
    const ld = productJsonLd({
      name: "Oxford Shirt",
      description: "<p>100% Cotton</p>",
      url: "https://habitt.in/product/oxford-shirt",
      images: ["https://cdn.example.com/1.jpg"],
      brandName: "Habitt",
      variants: [
        { pricePaise: 249900, stock: 0, sku: "OXF-S" },
        { pricePaise: 249900, stock: 4, sku: "OXF-M" },
      ],
      returnWindowDays: 7,
      freeReturnShipping: true,
      shippingFeePaise: 9900,
      freeShippingOnPrepaid: true,
      maxDeliveryDays: 5,
    }) as Record<string, unknown>;

    expect(ld["@type"]).toBe("Product");
    const offers = ld.offers as Record<string, unknown>;
    expect(offers["@type"]).toBe("Offer");
    expect(offers.price).toBe("2499.00");
    expect(offers.priceCurrency).toBe("INR");
    expect(offers.availability).toBe("https://schema.org/InStock");
    expect(JSON.stringify(ld)).not.toContain("handlingTime");
    expect(JSON.stringify(ld)).not.toContain("costPrice");
  });

  it("organizationJsonLd, websiteJsonLd, and breadcrumbJsonLd produce valid schema.org shapes", () => {
    const org = organizationJsonLd({
      name: "Habitt",
      url: "https://habitt.in",
      email: "care@habitt.in",
    }) as Record<string, unknown>;
    expect(org["@type"]).toBe("Organization");

    const site = websiteJsonLd({ name: "Habitt", url: "https://habitt.in" }) as Record<string, unknown>;
    expect(site["@type"]).toBe("WebSite");

    const bc = breadcrumbJsonLd([
      { name: "Home", url: "https://habitt.in" },
      { name: "Shop", url: "https://habitt.in/shop" },
    ]) as { itemListElement: Array<{ position: number }> };
    expect(bc.itemListElement).toHaveLength(2);
    expect(bc.itemListElement[1].position).toBe(2);
  });
});
