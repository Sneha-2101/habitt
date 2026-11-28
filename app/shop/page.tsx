import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import ProductCard from "@/components/ProductCard";
import { getActiveAutomaticOfferBadges, resolveOfferBadge } from "@/lib/offers/load";
import { storefrontProductWhere } from "@/lib/catalog/visibility";
import { getSettings } from "@/lib/settings";
import { buildBusinessProfile } from "@/lib/site/business";
import { getSiteUrl } from "@/lib/seo/site-url";
import { buildListingMetadata } from "@/lib/seo/metadata";
import { readOrBuildFallback } from "@/lib/build-safe";
import { safeErrorSummary } from "@/lib/log-redact";

// Dynamic by design: reads searchParams for category, search, and sort.

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; q?: string; sort?: string }>;
}): Promise<Metadata> {
  const resolved = await searchParams;
  const rawCategory = resolved.category?.trim();
  const hasFiltersOrSort = Boolean(
    rawCategory || resolved.q?.trim() || resolved.sort?.trim()
  );

  const [settings, categoryRow] = await Promise.all([
    getSettings(),
    rawCategory
      ? readOrBuildFallback(
          () =>
            prisma.category.findFirst({
              where: {
                active: true,
                OR: [
                  { slug: { equals: rawCategory, mode: "insensitive" } },
                  { name: { equals: rawCategory, mode: "insensitive" } },
                ],
              },
              select: { name: true, seoTitle: true, seoDescription: true, introText: true },
            }),
          null,
          "shop.generateMetadata.category"
        )
      : Promise.resolve(null),
  ]);

  const profile = buildBusinessProfile(settings);
  const siteUrl = getSiteUrl();

  const title = categoryRow?.seoTitle || categoryRow?.name || "Shop";
  const description =
    categoryRow?.seoDescription ||
    categoryRow?.introText ||
    profile.tagline ||
    profile.displayName;

  return buildListingMetadata({
    title,
    description,
    basePath: "/shop",
    hasFiltersOrSort,
    settings,
    siteUrl,
  });
}

export default async function ShopPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; q?: string }>;
}) {
  const resolvedParams = await searchParams;
  const rawCategoryParam = resolvedParams.category?.trim();
  const searchQuery = resolvedParams.q?.trim();

  const wishlistSet = new Set<string>();
  let categories: Array<{ id: string; slug: string; name: string; position: number }> = [];
  let activeCategory: { id: string; slug: string; name: string } | undefined;

  const loadShopProducts = async () => {
    categories = await prisma.category.findMany({
      where: { active: true },
      orderBy: { position: "asc" },
      select: { id: true, slug: true, name: true, position: true },
    });

    if (rawCategoryParam) {
      const paramLower = rawCategoryParam.toLowerCase();
      // Match against slug or name case-insensitively (supports old uppercase enum values)
      activeCategory = categories.find(
        (c) => c.slug.toLowerCase() === paramLower || c.name.toLowerCase() === paramLower
      );
    }

    const [dbProducts, offerBadges] = await Promise.all([
      prisma.product.findMany({
        where: {
          ...storefrontProductWhere(),
          ...(activeCategory ? { categoryId: activeCategory.id } : {}),
          ...(searchQuery ? { name: { contains: searchQuery, mode: "insensitive" } } : {}),
        },
        include: {
          images: true,
          variants: { select: { id: true, size: true, color: true, colorHex: true, stock: true } },
          category: true,
          collections: { select: { collectionId: true } },
          reviews: { select: { rating: true } },
        },
        orderBy: { createdAt: "desc" },
      }),
      getActiveAutomaticOfferBadges(),
    ]);
    return dbProducts.map((p) => ({
      ...p,
      offerBadge: resolveOfferBadge(
        p.id,
        p.categoryId,
        p.collections.map((c: { collectionId: string }) => c.collectionId),
        offerBadges
      ),
    }));
  };

  let products: Awaited<ReturnType<typeof loadShopProducts>> = [];
  try {
    products = await loadShopProducts();
  } catch (err) {
    console.error("ShopPage products fetch error:", safeErrorSummary(err));
  }

  return (
    <main className="px-4 sm:px-7 py-10">
      {searchQuery && (
        <div className="mb-6 p-4 rounded-xl bg-white border border-stone/30 flex justify-between items-center text-[13.5px]">
          <div>
            Showing results for <span className="font-semibold text-ink">&quot;{searchQuery}&quot;</span>
          </div>
          <Link href="/shop" className="text-stone-dark underline hover:text-ink">
            Clear search
          </Link>
        </div>
      )}
      <div className="flex gap-2 flex-wrap mb-8">
        <Link
          href="/shop"
          className={`px-4 py-2 rounded-full border text-[12.5px] tracking-[0.02em] transition-colors ${
            !activeCategory ? "bg-ink text-paper border-ink" : "border-stone hover:border-ink"
          }`}
        >
          All
        </Link>
        {categories.map((c) => (
          <Link
            key={c.id}
            href={`/shop?category=${c.slug}`}
            className={`px-4 py-2 rounded-full border text-[12.5px] tracking-[0.02em] transition-colors ${
              activeCategory?.id === c.id ? "bg-ink text-paper border-ink" : "border-stone hover:border-ink"
            }`}
          >
            {c.name}
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-5">
        {products.map((p) => (
          <ProductCard key={p.id} product={p} initialSaved={wishlistSet.has(p.id)} />
        ))}
        {products.length === 0 && (
          <p className="col-span-full text-sm text-stone-dark py-8">
            No products found in this category.
          </p>
        )}
      </div>
    </main>
  );
}
