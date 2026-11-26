import { describe, it, expect } from "vitest";
import {
  stripMarkupAndCollapse,
  truncateSeoDescription,
  buildPageMetadata,
  buildListingMetadata,
} from "@/lib/seo/metadata";

describe("seo/metadata", () => {
  it("strips HTML and markdown and collapses whitespace", () => {
    const cleaned = stripMarkupAndCollapse(
      "<p>Hello <strong>World</strong></p> [Shop now](https://example.com)   **bold**  "
    );
    expect(cleaned).toBe("Hello World Shop now bold");
  });

  it("truncates descriptions cleanly at word boundaries within maxLen", () => {
    const text = "Heavyweight organic cotton oxford shirt crafted for everyday wear in warm climates across India.";
    const truncated = truncateSeoDescription(text, 55);
    expect(truncated.length).toBeLessThanOrEqual(55);
    expect(truncated.endsWith(" ")).toBe(false);
  });

  it("buildPageMetadata strips query strings from canonical and uses ogDefaultImageUrl fallback", () => {
    const meta = buildPageMetadata({
      title: "About",
      description: "About our brand",
      path: "/about?utm_source=test",
      settings: {
        seoIndexingEnabled: false,
        ogDefaultImageUrl: "https://cdn.example.com/og.jpg",
      },
      siteUrl: "https://habitt.in",
    });

    expect(meta.alternates?.canonical).toBe("https://habitt.in/about");
    expect(meta.openGraph?.images).toEqual([{ url: "https://cdn.example.com/og.jpg" }]);
    expect(meta.robots).toEqual({ index: false, follow: false });
  });

  it("buildListingMetadata sets noindex,follow when filters or sort are active", () => {
    const meta = buildListingMetadata({
      title: "Shop",
      description: "All garments",
      basePath: "/shop",
      hasFiltersOrSort: true,
      settings: { seoIndexingEnabled: true },
      siteUrl: "https://habitt.in",
    });

    expect(meta.alternates?.canonical).toBe("https://habitt.in/shop");
    expect(meta.robots).toEqual({ index: false, follow: true });
  });
});
