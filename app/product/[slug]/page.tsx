import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { formatINR } from "@/lib/money";
import { savingsPaise } from "@/lib/catalog/pricing-display";
import { CareTag } from "@/components/CareTag";
import ProductImageGallery from "@/components/ProductImageGallery";
import AddToBagPanel from "@/components/AddToBagPanel";
import WishlistButton from "@/components/WishlistButton";
import StarRating from "@/components/StarRating";
import ProductReviews from "@/components/ProductReviews";
import RecordRecentlyViewed from "@/components/RecordRecentlyViewed";
import { getWishlistProductIds } from "@/lib/actions/wishlist";
import { getReviewsForProduct, getAverageRating } from "@/lib/actions/reviews";
import { auth } from "@/lib/auth";
import { getSettings } from "@/lib/settings";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const resolvedParams = await params;
  const product = await prisma.product.findUnique({
    where: { slug: resolvedParams.slug },
    select: {
      name: true,
      description: true,
      seoTitle: true,
      seoDescription: true,
      status: true,
    },
  });

  if (!product || product.status !== "ACTIVE") {
    return {
      title: "Product Not Found — Habitt",
    };
  }

  const title = product.seoTitle || `${product.name} — Habitt`;
  const descRaw = product.seoDescription || product.description || "";
  const description = descRaw.length > 155 ? descRaw.substring(0, 155) : descRaw;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
    },
  };
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const resolvedParams = await params;
  const session = await auth(); // display only
  const userId = session?.user?.id;

  const [product, wishlistIds, settings] = await Promise.all([
    prisma.product.findUnique({
      where: { slug: resolvedParams.slug },
      include: { images: true, variants: true, category: true },
    }),
    getWishlistProductIds(),
    getSettings(),
  ]);

  if (!product || product.status !== "ACTIVE") notFound();

  const [reviews, ratingAggregate, hasPurchased, hasReviewed] = await Promise.all([
    getReviewsForProduct(product.id),
    getAverageRating(product.id),
    userId
      ? prisma.orderItem
          .findFirst({
            where: {
              productId: product.id,
              order: {
                userId,
                OR: [
                  { fulfilmentStatus: { in: ["SHIPPED", "DELIVERED"] } },
                  { fulfilmentStatus: "PLACED", paymentStatus: "PAID" },
                ],
              },
            },
          })
          .then(Boolean)
      : Promise.resolve(false),
    userId
      ? prisma.review
          .findUnique({
            where: { userId_productId: { userId, productId: product.id } },
          })
          .then(Boolean)
      : Promise.resolve(false),
  ]);

  const isSaved = wishlistIds.includes(product.id);
  const savings = savingsPaise(product.price, product.compareAtPrice);

  return (
    <main className="px-4 sm:px-7 py-10 max-w-5xl mx-auto">
      <RecordRecentlyViewed
        product={{
          id: product.id,
          name: product.name,
          slug: product.slug,
          price: product.price,
          category: product.category?.name?.toUpperCase() ?? "",
          imageUrl: product.images[0]?.url,
        }}
      />
      <div className="grid md:grid-cols-2 gap-8 md:gap-10 items-start">
        <div>
          <ProductImageGallery url={product.images[0]?.url} category={product.category?.name?.toUpperCase() ?? ""} />
        </div>
        <div>
          <div className="flex justify-between items-start gap-4">
            <h1 className="font-display text-2xl md:text-3xl font-medium leading-tight">
              {product.name}
            </h1>
            <div className="flex items-center gap-2 shrink-0">
              <WishlistButton productId={product.id} initialSaved={isSaved} />
              <CareTag>{product.category?.name?.toUpperCase() ?? ""}</CareTag>
            </div>
          </div>

          <div className="flex items-center gap-3 mt-3">
            <div className="flex items-center gap-2 font-mono text-lg font-medium">
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
            {ratingAggregate.count > 0 && (
              <div className="flex items-center gap-1 pl-3 border-l border-stone">
                <StarRating rating={ratingAggregate.average} size="sm" showNumeric />
                <span className="text-xs text-stone-dark">({ratingAggregate.count})</span>
              </div>
            )}
          </div>

          <p className="text-[13.5px] text-[#4B473F] mt-4 leading-relaxed">
            {product.description}
          </p>

          {(product.fabric || product.fit || product.care) && (
            <details className="mt-4 border-t border-stone/50 pt-3 text-[13px] text-ink cursor-pointer">
              <summary className="font-medium tracking-[0.04em] uppercase text-[11px] text-stone-dark hover:text-ink select-none">
                Fabric & care
              </summary>
              <div className="mt-2 space-y-1 text-stone-dark text-[12.5px] cursor-default">
                {product.fabric && (
                  <div>
                    <span className="font-medium text-ink">Fabric: </span>
                    {product.fabric}
                  </div>
                )}
                {product.fit && (
                  <div>
                    <span className="font-medium text-ink">Fit: </span>
                    {product.fit}
                  </div>
                )}
                {product.care && (
                  <div>
                    <span className="font-medium text-ink">Care: </span>
                    {product.care}
                  </div>
                )}
              </div>
            </details>
          )}

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

      {/* Product Reviews & Ratings Section */}
      <ProductReviews
        productId={product.id}
        reviews={reviews}
        isLoggedIn={!!userId}
        hasPurchased={hasPurchased}
        hasReviewed={hasReviewed}
      />
    </main>
  );
}
