import Link from "next/link";
import { prisma } from "@/lib/prisma";
import type { Category } from "@prisma/client";
import { formatINR } from "@/lib/money";
import { CareTag } from "@/components/CareTag";
import { ProductSwatchImage } from "@/components/ProductSwatchImage";

const CATEGORIES: Category[] = ["SHIRTS", "OVERSHIRTS", "POLOS", "TROUSERS"];

export default async function ShopPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>;
}) {
  const resolvedParams = await searchParams;
  const activeCategory = resolvedParams.category as Category | undefined;

  const products = await prisma.product.findMany({
    where: {
      status: "ACTIVE",
      ...(activeCategory ? { category: activeCategory } : {}),
    },
    include: { images: true },
    orderBy: { createdAt: "desc" },
  });

  return (
    <main className="px-4 sm:px-7 py-10">
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
          <Link key={p.id} href={`/product/${p.slug}`} className="block bg-card group">
            <ProductSwatchImage url={p.images[0]?.url} category={p.category} />
            <div className="p-3">
              <div className="flex justify-between items-start">
                <div>
                  <div className="text-sm font-medium group-hover:opacity-75 transition-opacity">
                    {p.name}
                  </div>
                  <div className="text-[12px] text-stone-dark mt-0.5">
                    {p.category[0] + p.category.slice(1).toLowerCase()}
                  </div>
                </div>
                <CareTag>{p.category}</CareTag>
              </div>
              <div className="font-mono text-[13px] mt-3">{formatINR(p.price)}</div>
            </div>
          </Link>
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
