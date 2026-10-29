import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { formatINR } from "@/lib/money";
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

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const resolvedParams = await params;
  const session = await auth();
  const userId = session?.user?.id;

  const [product, wishlistIds, settings] = await Promise.all([
    prisma.product.findUnique({
      where: { slug: resolvedParams.slug },
      include: { images: true, variants: true },
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
                status: { in: ["PAID", "SHIPPED", "DELIVERED"] },
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

  return (
    <main className="px-4 sm:px-7 py-10 max-w-5xl mx-auto">
      <RecordRecentlyViewed
        product={{
          id: product.id,
          name: product.name,
          slug: product.slug,
          price: product.price,
          category: product.category,
          imageUrl: product.images[0]?.url,
        }}
      />
      <div className="grid md:grid-cols-2 gap-8 md:gap-10 items-start">
        <div>
          <ProductImageGallery url={product.images[0]?.url} category={product.category} />
        </div>
        <div>
          <div className="flex justify-between items-start gap-4">
            <h1 className="font-display text-2xl md:text-3xl font-medium leading-tight">
              {product.name}
            </h1>
            <div className="flex items-center gap-2 shrink-0">
              <WishlistButton productId={product.id} initialSaved={isSaved} />
              <CareTag>{product.category}</CareTag>
            </div>
          </div>

          <div className="flex items-center gap-3 mt-3">
            <div className="font-mono text-lg font-medium">
              {formatINR(product.price)}
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

          <AddToBagPanel
            productId={product.id}
            productName={product.name}
            price={product.price}
            category={product.category}
            variants={product.variants}
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
