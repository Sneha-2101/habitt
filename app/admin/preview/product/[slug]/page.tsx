import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { formatINR } from "@/lib/money";
import { savingsPaise } from "@/lib/catalog/pricing-display";
import { CareTag } from "@/components/CareTag";
import ProductImageGallery from "@/components/ProductImageGallery";
import AddToBagPanel from "@/components/AddToBagPanel";
import { ForbiddenError, requireStaff, UnauthorizedError } from "@/lib/guards";
import { getSettings } from "@/lib/settings";
import { isProductVisible } from "@/lib/catalog/visibility";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Staff Product Preview",
  robots: { index: false, follow: false },
};

export default async function AdminProductPreviewPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  try {
    await requireStaff();
  } catch (err) {
    if (err instanceof UnauthorizedError || err instanceof ForbiddenError) {
      redirect("/staff/login");
    }
    throw err;
  }

  const { slug } = await params;
  const [product, settings] = await Promise.all([
    prisma.product.findUnique({
      where: { slug },
      include: {
        images: { orderBy: { position: "asc" } },
        variants: true,
        category: true,
      },
    }),
    getSettings(),
  ]);

  if (!product) notFound();
  const visible = isProductVisible(product);
  const savings = savingsPaise(product.price, product.compareAtPrice);

  return (
    <main className="px-4 sm:px-7 py-10 max-w-5xl mx-auto">
      {!visible && (
        <div className="mb-6 p-3 bg-amber-50 border border-amber-200 text-amber-900 text-xs font-mono uppercase tracking-wider flex items-center justify-between">
          <span>Scheduled / not public</span>
          <span>Staff Preview Mode</span>
        </div>
      )}
      <div className="grid md:grid-cols-2 gap-8 md:gap-10 items-start">
        <div>
          <ProductImageGallery
            url={product.images[0]?.url}
            category={product.category?.name?.toUpperCase() ?? ""}
            productName={product.name}
            altText={product.images[0]?.altText}
            priority
          />
        </div>
        <div>
          <div className="flex justify-between items-start gap-4">
            <h1 className="font-display text-2xl md:text-3xl font-medium leading-tight">
              {product.name}
            </h1>
            <CareTag>{product.category?.name?.toUpperCase() ?? ""}</CareTag>
          </div>
          <div className="flex items-center gap-2 font-mono text-lg font-medium mt-3">
            <span>{formatINR(product.price)}</span>
            {savings !== null && product.compareAtPrice && (
              <>
                <span className="line-through text-stone-dark text-sm">
                  {formatINR(product.compareAtPrice)}
                </span>
                <CareTag>SAVE {formatINR(savings)}</CareTag>
              </>
            )}
          </div>
          <p className="text-[13.5px] text-[#4B473F] mt-4 leading-relaxed">
            {product.description}
          </p>
          <AddToBagPanel
            productId={product.id}
            productName={product.name}
            price={product.price}
            category={product.category?.name?.toUpperCase() ?? ""}
            categorySizes={product.category?.sizes ?? []}
            variants={product.variants.map((v) => ({
              id: v.id,
              size: v.size,
              color: v.color,
              colorHex: v.colorHex,
              stock: v.stock,
            }))}
            sizeChartUrl={product.sizeChartUrl}
            freeShippingThreshold={settings.freeShippingThreshold}
            freeShippingOnPrepaid={settings.freeShippingOnPrepaid}
          />
        </div>
      </div>
    </main>
  );
}
