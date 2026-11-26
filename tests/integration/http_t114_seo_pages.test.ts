import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "../helpers/prisma";
import { cleanupM1TestRows, createTestProduct, genId } from "../helpers/fixtures";

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3000";

describe("T114: HTTP SEO Endpoints & Storefront Metadata", () => {
  beforeEach(async () => {
    await cleanupM1TestRows();
  });

  afterEach(async () => {
    await cleanupM1TestRows();
  });

  it("serves robots.txt (disallow all in dev), sitemap.xml, and 404 no-store on /feed/google when indexing is blocked", async () => {
    const [robotsRes, sitemapRes, feedRes] = await Promise.all([
      fetch(`${BASE_URL}/robots.txt`),
      fetch(`${BASE_URL}/sitemap.xml`),
      fetch(`${BASE_URL}/feed/google`),
    ]);

    expect(robotsRes.status).toBe(200);
    const robotsText = await robotsRes.text();
    expect(robotsText).toContain("User-Agent:");
    expect(robotsText).toContain("Disallow: /");

    expect(sitemapRes.status).toBe(200);
    const sitemapXml = await sitemapRes.text();
    expect(sitemapXml).toContain("<urlset");

    expect(feedRes.status).toBe(404);
    expect(feedRes.headers.get("cache-control")).toContain("no-store");
  });

  it("renders JSON-LD on / and noindex on filtered /shop?sort=price-asc", async () => {
    const [homeRes, shopFilteredRes] = await Promise.all([
      fetch(`${BASE_URL}/`),
      fetch(`${BASE_URL}/shop?sort=price-asc`),
    ]);

    expect(homeRes.status).toBe(200);
    const homeHtml = await homeRes.text();
    expect(homeHtml).toContain("application/ld+json");

    expect(shopFilteredRes.status).toBe(200);
    const shopHtml = await shopFilteredRes.text();
    expect(shopHtml).toMatch(/name="robots"[^>]*noindex/);
  });

  it("blocks unauthenticated access to /admin/preview/product/<slug> and redirects old product slugs with 308", async () => {
    const { product } = await createTestProduct({ status: "ACTIVE", price: 199900 });
    const oldSlug = genId("m1test_old_slug");
    await prisma.productSlugRedirect.create({
      data: {
        id: genId("m1test_psr"),
        oldSlug,
        productId: product.id,
      },
    });

    const previewRes = await fetch(`${BASE_URL}/admin/preview/product/${product.slug}`, {
      redirect: "manual",
    });
    expect(previewRes.status).not.toBe(200);
    const previewBody = await previewRes.text();
    expect(previewBody).not.toContain(product.name);

    const redirectRes = await fetch(`${BASE_URL}/product/${oldSlug}`, {
      redirect: "manual",
    });
    expect(redirectRes.status).toBe(308);
    expect(redirectRes.headers.get("location")).toContain(`/product/${product.slug}`);
  });
});
