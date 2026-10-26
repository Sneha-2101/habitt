import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatINR } from "@/lib/money";
import ProductCard from "@/components/ProductCard";
import RecentlyViewed from "@/components/RecentlyViewed";

export default async function HomePage() {
  let featured: any[] = [];
  try {
    featured = await prisma.product.findMany({
      where: { status: "ACTIVE" },
      include: {
        images: true,
        variants: true,
        reviews: { select: { rating: true } },
      },
      take: 8,
      orderBy: { createdAt: "desc" },
    });
  } catch (err) {
    console.error("HomePage products fetch error:", err);
  }

  return (
    <main>
      {/* HERO SECTION */}
      <section className="relative px-4 sm:px-7 pt-12 sm:pt-18 pb-14 overflow-hidden">
        {/* Diagonal placket crease line */}
        <div className="absolute top-[40%] -left-[5%] -right-[5%] h-[1px] bg-stone-dark -rotate-3 pointer-events-none" />

        <p className="font-mono text-[11px] tracking-[0.12em] text-moss mb-3 uppercase">
          A/W COLLECTION — MADE TO WEAR IN
        </p>
        <h1 className="font-display italic font-medium text-[clamp(36px,6vw,68px)] leading-[1.02] max-w-3xl">
          Clothes with a quiet weight to them.
        </h1>
        <p className="max-w-md mt-5 text-[15px] text-[#4B473F] leading-relaxed">
          Habitt makes considered basics — heavier fabrics, honest fits, nothing shouting for
          attention. Free shipping over {formatINR(299900)}.
        </p>
        <Link
          href="/shop"
          className="inline-block mt-8 px-7 py-3 bg-ink text-paper text-[13px] tracking-[0.06em] uppercase hover:opacity-90 transition-opacity"
        >
          SHOP ALL
        </Link>
      </section>

      {/* FEATURED PRODUCT GRID */}
      <section className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-5 px-4 sm:px-7 pb-14">
        {featured.map((p) => (
          <ProductCard key={p.id} product={p} />
        ))}
        {featured.length === 0 && (
          <p className="col-span-full text-sm text-stone-dark py-8">
            No products yet — add some from /admin/products.
          </p>
        )}
      </section>

      {/* RECENTLY VIEWED ROW */}
      <RecentlyViewed />
    </main>
  );
}
