import { describe, it, expect } from "vitest";
import { escapeXml, buildGoogleFeedXml } from "@/lib/seo/feed";

describe("seo/feed", () => {
  it("escapes XML special characters and strips control chars", () => {
    expect(escapeXml(`A & B <C> "D" 'E'\x00`)).toBe(
      "A &amp; B &lt;C&gt; &quot;D&quot; &apos;E&apos;"
    );
  });

  it("builds valid Google Shopping RSS XML with INR prices and variant attributes", () => {
    const xml = buildGoogleFeedXml({
      siteUrl: "https://habitt.in/",
      displayName: "Habitt & Co",
      items: [
        {
          productId: "prod_1",
          variantId: "var_1",
          sku: "HAB-01-M",
          title: "Linen Shirt",
          description: "<p>Breathable & light</p>",
          slug: "linen-shirt",
          imageUrl: "https://cdn.example.com/shirt.jpg",
          pricePaise: 299900,
          stock: 3,
          color: "Ivory",
          size: "M",
        },
        {
          productId: "prod_1",
          variantId: "var_2",
          sku: null,
          title: "Linen Shirt",
          description: "Breathable",
          slug: "linen-shirt",
          imageUrl: "https://cdn.example.com/shirt.jpg",
          pricePaise: 299900,
          stock: 0,
          color: null,
          size: "L",
        },
      ],
    });

    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain("<g:id>HAB-01-M</g:id>");
    expect(xml).toContain("<g:id>prod_1-var_2</g:id>");
    expect(xml).toContain("<g:price>2999.00 INR</g:price>");
    expect(xml).toContain("<g:availability>in_stock</g:availability>");
    expect(xml).toContain("<g:availability>out_of_stock</g:availability>");
    expect(xml).toContain("<g:color>Ivory</g:color>");
    expect(xml).toContain("<g:size>M</g:size>");
    expect(xml).toContain("<g:brand>Habitt &amp; Co</g:brand>");
    expect(xml).not.toContain("costPrice");
  });
});
