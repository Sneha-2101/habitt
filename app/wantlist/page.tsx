import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/sessions";
import { prisma } from "@/lib/prisma";
import { formatINR } from "@/lib/money";
import { CareTag } from "@/components/CareTag";
import { ProductSwatchImage } from "@/components/ProductSwatchImage";
import WishlistButton from "@/components/WishlistButton";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Wantlist — Habitt",
  description: "Your saved garments and considered pieces.",
};

export default async function WantlistPage() {
  const sessionUser = await getSessionUser();
  const userId = sessionUser?.id;

  if (!userId) {
    redirect("/login?redirect=/wantlist");
  }

  let items: any[] = [];
  try {
    items = await prisma.wishlistItem.findMany({
      where: { userId },
      include: {
        product: {
          include: { images: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  } catch (err) {
    console.error("Wantlist query error:", err);
  }

  const products = items.map((i) => i.product);

  return (
    <main className="px-4 sm:px-7 py-10 max-w-6xl mx-auto">
      <div className="flex justify-between items-center mb-8 border-b border-stone pb-5">
        <div>
          <h1 className="font-display italic text-3xl font-medium">Your Wantlist</h1>
          <p className="text-[13px] text-stone-dark mt-1">
            {products.length} {products.length === 1 ? "saved item" : "saved items"}
          </p>
        </div>
        <Link
          href="/shop"
          className="text-[12.5px] font-medium tracking-[0.03em] underline hover:opacity-75"
        >
          Explore collection →
        </Link>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-5">
        {products.map((p) => (
          <div key={p.id} className="relative group">
            <Link
              href={`/product/${p.slug}`}
              className="block bg-white rounded-2xl p-2 border border-stone/30 shadow-[0_8px_24px_rgba(0,0,0,0.06)] hover:shadow-[0_12px_32px_rgba(0,0,0,0.1)] transition-all duration-300"
            >
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
            <div className="absolute top-4 right-4 z-10">
              <WishlistButton productId={p.id} initialSaved={true} />
            </div>
          </div>
        ))}

        {products.length === 0 && (
          <div className="col-span-full py-16 text-center border border-dashed border-stone/60 rounded-2xl bg-white/50">
            <p className="font-display italic text-xl mb-2 text-ink">Your Wantlist is empty</p>
            <p className="text-[13px] text-stone-dark mb-6">
              Save pieces you love to keep track of your considered wardrobe.
            </p>
            <Link
              href="/shop"
              className="inline-block px-7 py-3 bg-ink text-paper text-[12.5px] tracking-[0.06em] uppercase hover:opacity-90 transition-opacity"
            >
              Browse Shop
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}
