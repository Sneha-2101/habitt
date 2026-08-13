import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatINR } from "@/lib/money";
import { CareTag } from "@/components/CareTag";
import { ProductSwatchImage } from "@/components/ProductSwatchImage";

export default async function HomePage() {
  const featured = await prisma.product.findMany({
    where: { status: "ACTIVE" },
    include: { images: true, variants: true },
    take: 8,
    orderBy: { createdAt: "desc" },
  });

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
      <section className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-5 px-4 sm:px-7 pb-18">
        {featured.map((p) => (
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
              <div className="font-mono text-[13px] mt-3">
                {formatINR(p.price)}
              </div>
            </div>
          </Link>
        ))}
        {featured.length === 0 && (
          <p className="col-span-full text-sm text-stone-dark py-8">
            No products yet — add some from /admin/products.
          </p>
        )}
      </section>
    </main>
  );
}
