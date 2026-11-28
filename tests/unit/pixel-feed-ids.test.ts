import { describe, it, expect } from "vitest";
import { formatFeedVariantId } from "@/lib/seo/feed-id";
import { buildGoogleFeedXml } from "@/lib/seo/feed";
import {
  buildViewContentPayload,
  buildAddToCartPayload,
  buildInitiateCheckoutPayload,
  buildPurchasePayload,
} from "@/lib/consent/pixel-payload";

describe("pixel and Google feed id alignment", () => {
  it("formatFeedVariantId matches legacy feed id format byte-for-byte", () => {
    expect(
      formatFeedVariantId({ productId: "prod_1", variantId: "var_1", sku: "SKU-001" })
    ).toBe("SKU-001");
    expect(
      formatFeedVariantId({ productId: "prod_1", variantId: "var_1", sku: "  SKU-002  " })
    ).toBe("SKU-002");
    expect(
      formatFeedVariantId({ productId: "prod_1", variantId: "var_1", sku: "" })
    ).toBe("prod_1-var_1");
    expect(
      formatFeedVariantId({ productId: "prod_1", variantId: "var_1", sku: null })
    ).toBe("prod_1-var_1");
  });

  it("buildGoogleFeedXml emits exact formatFeedVariantId output in <g:id>", () => {
    const xml = buildGoogleFeedXml({
      siteUrl: "https://example.com",
      displayName: "Habitt",
      items: [
        {
          productId: "p1",
          variantId: "v1",
          sku: "HB-TEE-M",
          title: "Tee",
          description: "Desc",
          slug: "tee",
          imageUrl: "https://example.com/1.jpg",
          pricePaise: 99900,
          stock: 3,
        },
        {
          productId: "p2",
          variantId: "v2",
          sku: null,
          title: "Pant",
          description: "Desc",
          slug: "pant",
          imageUrl: "https://example.com/2.jpg",
          pricePaise: 199900,
          stock: 2,
        },
      ],
    });

    expect(xml).toContain("<g:id>HB-TEE-M</g:id>");
    expect(xml).toContain("<g:id>p2-v2</g:id>");
  });

  it("Pixel payload builders emit matching feed IDs with content_type 'product' and no PII", () => {
    const v1 = { productId: "p1", variantId: "v1", sku: "HB-TEE-M" };
    const v2 = { productId: "p2", variantId: "v2", sku: null };
    const id1 = formatFeedVariantId(v1);
    const id2 = formatFeedVariantId(v2);

    const vc = buildViewContentPayload({
      contentId: id1,
      productName: "Tee",
      priceRupees: 999,
    });
    expect(vc.content_ids).toEqual([id1]);
    expect(vc.content_type).toBe("product");

    const atc = buildAddToCartPayload({ variant: v2, priceRupees: 1999 });
    expect(atc.content_ids).toEqual([id2]);
    expect(atc.content_type).toBe("product");

    const ic = buildInitiateCheckoutPayload({
      items: [
        { ...v1, qty: 1 },
        { ...v2, qty: 2 },
      ],
      subtotalRupees: 4997,
    });
    expect(ic.content_ids).toEqual([id1, id2]);
    expect(ic.content_type).toBe("product");
    expect(ic.num_items).toBe(3);

    const pur = buildPurchasePayload({
      orderId: "HB-1001",
      totalRupees: 4997,
      items: [v1, v2],
    });
    expect(pur.content_ids).toEqual([id1, id2]);
    expect(pur.content_type).toBe("product");
    expect(pur.order_id).toBe("HB-1001");
  });
});
