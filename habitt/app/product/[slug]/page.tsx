import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { formatINR } from "@/lib/money";
import { CareTag } from "@/components/CareTag";
import { ProductSwatchImage } from "@/components/ProductSwatchImage";
import AddToBagPanel from "@/components/AddToBagPanel";

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const resolvedParams = await params;
  const product = await prisma.product.findUnique({
    where: { slug: resolvedParams.slug },
    include: { images: true, variants: true },
  });

  if (!product || product.status !== "ACTIVE") notFound();

  return (
    <main className="px-4 sm:px-7 py-10 grid md:grid-cols-2 gap-8 md:gap-10 max-w-5xl mx-auto items-start">
      <div className="bg-card border border-stone/40 overflow-hidden">
        <ProductSwatchImage url={product.images[0]?.url} category={product.category} />
      </div>
      <div>
        <div className="flex justify-between items-start">
          <h1 className="font-display text-2xl md:text-3xl font-medium leading-tight">
            {product.name}
          </h1>
          <CareTag>{product.category}</CareTag>
        </div>
        <div className="font-mono text-lg mt-3 font-medium">
          {formatINR(product.price)}
        </div>
        <p className="text-[13.5px] text-[#4B473F] mt-4 leading-relaxed">
          {product.description}
        </p>

        <AddToBagPanel
          productId={product.id}
          productName={product.name}
          price={product.price}
          variants={product.variants}
        />
      </div>
    </main>
  );
}
