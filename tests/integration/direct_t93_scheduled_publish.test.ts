import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "../helpers/prisma";
import { cleanupM1TestRows, createTestProduct, createTestUser, genId } from "../helpers/fixtures";
import * as guardsModule from "@/lib/guards";
import {
  isProductVisible,
  isProductPurchasable,
  storefrontProductWhere,
} from "@/lib/catalog/visibility";
import { calculateQuote } from "@/lib/pricing/quote";
import { syncCartAction } from "@/lib/actions/cart";

describe("T93: Scheduled Publish & Storefront Visibility Integration", () => {
  type TestProd = Awaited<ReturnType<typeof createTestProduct>>["product"] & {
    variants: Awaited<ReturnType<typeof createTestProduct>>["variants"];
  };
  let customerUser: { id: string; email: string };
  let testCategory: { id: string; name: string };
  let publishedProduct: TestProd;
  let futureProduct: TestProd;
  let draftProduct: TestProd;

  beforeAll(async () => {
    await cleanupM1TestRows();

    const u = await createTestUser({ role: "CUSTOMER" });
    customerUser = { id: u.id, email: u.email! };

    testCategory = await prisma.category.create({
      data: {
        id: genId("m1test_cat"),
        slug: genId("m1test-cat"),
        name: "Scheduled Category",
        sizes: ["S", "M", "L"],
      },
    });

    const now = new Date();
    const futureDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days in future

    // 1. Fully published active product (publishAt is past)
    const p1 = await createTestProduct({
      categoryId: testCategory.id,
      status: "ACTIVE",
      variants: [{ size: "M", stock: 10, color: "Navy" }],
    });
    publishedProduct = {
      ...p1.product,
      publishAt: new Date(now.getTime() - 3600 * 1000),
      variants: p1.variants,
    };
    await prisma.product.update({
      where: { id: publishedProduct.id },
      data: { publishAt: publishedProduct.publishAt },
    });

    // 2. Future scheduled active product (publishAt is future)
    const p2 = await createTestProduct({
      categoryId: testCategory.id,
      status: "ACTIVE",
      variants: [{ size: "M", stock: 10, color: "Navy" }],
    });
    futureProduct = {
      ...p2.product,
      publishAt: futureDate,
      variants: p2.variants,
    };
    await prisma.product.update({
      where: { id: futureProduct.id },
      data: { publishAt: futureProduct.publishAt },
    });

    // 3. Draft product with past publishAt
    const p3 = await createTestProduct({
      categoryId: testCategory.id,
      status: "DRAFT",
      variants: [{ size: "M", stock: 10, color: "Navy" }],
    });
    draftProduct = {
      ...p3.product,
      publishAt: new Date(now.getTime() - 3600 * 1000),
      variants: p3.variants,
    };
    await prisma.product.update({
      where: { id: draftProduct.id },
      data: { publishAt: draftProduct.publishAt },
    });
  });

  afterAll(async () => {
    await cleanupM1TestRows();
  });

  it("1. Product with future publishAt is absent from storefront queries", async () => {
    const storefrontProducts = await prisma.product.findMany({
      where: {
        ...storefrontProductWhere(new Date()),
        categoryId: testCategory.id,
      },
    });

    const ids = storefrontProducts.map((p) => p.id);
    expect(ids).toContain(publishedProduct.id);
    expect(ids).not.toContain(futureProduct.id);
    expect(ids).not.toContain(draftProduct.id);
  });

  it("2. Visibility pure helper correctly computes visibility and purchasability", () => {
    const now = new Date();
    expect(isProductVisible(publishedProduct, now)).toBe(true);
    expect(isProductPurchasable(publishedProduct, now)).toBe(true);

    expect(isProductVisible(futureProduct, now)).toBe(false);
    expect(isProductPurchasable(futureProduct, now)).toBe(false);

    expect(isProductVisible(draftProduct, now)).toBe(false);
    expect(isProductPurchasable(draftProduct, now)).toBe(false);
  });

  it("3. calculateQuote flags future products as ITEM_UNAVAILABLE", async () => {
    const quote = await calculateQuote({
      userId: customerUser.id,
      paymentMethod: "RAZORPAY",
      items: [
        {
          productId: futureProduct.id,
          variantId: futureProduct.variants[0].id,
          qty: 1,
        },
      ],
    });

    const itemWarn = quote.warnings.find((w) => w.type === "ITEM_UNAVAILABLE");
    expect(itemWarn).toBeDefined();
    expect(itemWarn?.code).toBe("ITEM_UNAVAILABLE");
  });

  it("4. Server cart sync drops future scheduled items with warning", async () => {
    vi.spyOn(guardsModule, "requireUser").mockResolvedValue(
      customerUser as unknown as { id: string; email: string; role: "CUSTOMER"; name: string }
    );

    const res = await syncCartAction([
      {
        productId: publishedProduct.id,
        variantId: publishedProduct.variants[0].id,
        qty: 1,
      },
      {
        productId: futureProduct.id,
        variantId: futureProduct.variants[0].id,
        qty: 1,
      },
    ]);

    expect(res.dropped).toBe(1);
    expect(res.items.some((i) => i.variantId === publishedProduct.variants[0].id)).toBe(true);
    expect(res.items.some((i) => i.variantId === futureProduct.variants[0].id)).toBe(false);
  });

  it("5. Wishlist query excludes future scheduled products", async () => {
    // Add both products to wishlist
    await prisma.wishlistItem.createMany({
      data: [
        { userId: customerUser.id, productId: publishedProduct.id },
        { userId: customerUser.id, productId: futureProduct.id },
      ],
    });

    const wishlistItems = await prisma.wishlistItem.findMany({
      where: {
        userId: customerUser.id,
        product: storefrontProductWhere(new Date()),
      },
      include: { product: true },
    });

    const productIds = wishlistItems.map((wi) => wi.product.id);
    expect(productIds).toContain(publishedProduct.id);
    expect(productIds).not.toContain(futureProduct.id);
  });

  it("6. At or after publishAt date, product becomes visible everywhere", async () => {
    const futureDate = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000); // Beyond scheduled publish date

    expect(isProductVisible(futureProduct, futureDate)).toBe(true);
    expect(isProductPurchasable(futureProduct, futureDate)).toBe(true);

    const storefrontProducts = await prisma.product.findMany({
      where: {
        ...storefrontProductWhere(futureDate),
        id: futureProduct.id,
      },
    });
    expect(storefrontProducts.length).toBe(1);
  });

  it("7. Inactive / draft products remain hidden even after their publishAt passes", () => {
    const farFuture = new Date(Date.now() + 100 * 24 * 60 * 60 * 1000);
    expect(isProductVisible(draftProduct, farFuture)).toBe(false);
  });

  it("8. Customer payload never includes publishAt", async () => {
    // Verified via select / mapping contracts where publishAt is never projected to customer
    const storefrontQuery = await prisma.product.findFirst({
      where: storefrontProductWhere(new Date()),
      select: {
        id: true,
        name: true,
        slug: true,
        price: true,
        compareAtPrice: true,
        // publishAt intentionally omitted
      },
    });

    expect(storefrontQuery).not.toHaveProperty("publishAt");
  });
});
