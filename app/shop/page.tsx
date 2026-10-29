import Link from "next/link";
import { prisma } from "@/lib/prisma";
import type { Category } from "@prisma/client";
import { formatINR } from "@/lib/money";
import { CareTag } from "@/components/CareTag";
import { ProductSwatchImage } from "@/components/ProductSwatchImage";
import WishlistButton from "@/components/WishlistButton";
import ProductCard from "@/components/ProductCard";
import { getWishlistProductIds } from "@/lib/actions/wishlist";

const CATEGORIES: Category[] = ["SHIRTS", "OVERSHIRTS", "POLOS", "TROUSERS"];

export default async function ShopPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; q?: string }>;
}) {
  const resolvedParams = await searchParams;
  const activeCategory = resolvedParams.category as Category | undefined;
  const searchQuery = resolvedParams.q?.trim();

  let products: any[] = [];
  let wishlistSet = new Set<string>();

  try {
    const [dbProducts, wishlistIds] = await Promise.all([
      prisma.product.findMany({
        where: {
          status: "ACTIVE",
          ...(activeCategory ? { category: activeCategory } : {}),
          ...(searchQuery ? { name: { contains: searchQuery, mode: "insensitive" } } : {}),
        },
        include: {
          images: true,
          variants: true,
          reviews: { select: { rating: true } },
        },
        orderBy: { createdAt: "desc" },
      }),
      getWishlistProductIds(),
    ]);
    products = dbProducts;
    wishlistSet = new Set(wishlistIds);
  } catch (err) {
    console.error("ShopPage products fetch error:", err);
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
        {CATEGORIES.map((c) => (
          <Link
            key={c}
            href={`/shop?category=${c}`}
            className={`px-4 py-2 rounded-full border text-[12.5px] tracking-[0.02em] transition-colors ${
              activeCategory === c ? "bg-ink text-paper border-ink" : "border-stone hover:border-ink"
            }`}
          >
            {c[0] + c.slice(1).toLowerCase()}
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
