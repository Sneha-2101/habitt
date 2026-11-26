import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { formatINR } from "@/lib/money";
import { savingsPaise } from "@/lib/catalog/pricing-display";
import { CareTag } from "@/components/CareTag";
import ProductImageGallery from "@/components/ProductImageGallery";
import { ProductColorProvider } from "@/components/ProductColorContext";
import AddToBagPanel from "@/components/AddToBagPanel";
import WishlistButton from "@/components/WishlistButton";
import StarRating from "@/components/StarRating";
import ProductReviews from "@/components/ProductReviews";
import RecordRecentlyViewed from "@/components/RecordRecentlyViewed";
import TrackViewContentPixel from "@/components/TrackViewContentPixel";
import JsonLd from "@/components/seo/JsonLd";
import { getReviewsForProduct, getAverageRating } from "@/lib/actions/reviews";
import { getSettings } from "@/lib/settings";
import { buildBusinessProfile } from "@/lib/site/business";
import { getActiveAutomaticOfferBadges, resolveOfferBadge } from "@/lib/offers/load";
import { isProductVisible } from "@/lib/catalog/visibility";
import { groupVariants, pickDefaultVariant } from "@/lib/catalog/variants";
import { getSiteUrl } from "@/lib/seo/site-url";
import { buildPageMetadata } from "@/lib/seo/metadata";
import { breadcrumbJsonLd, productJsonLd } from "@/lib/seo/jsonld";

export const revalidate = 60;
export const dynamicParams = true;

export async function generateStaticParams() {
  return [];
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const resolvedParams = await params;
  const [product, settings] = await Promise.all([
    prisma.product.findUnique({
      where: { slug: resolvedParams.slug },
      select: {
        name: true,
        slug: true,
        description: true,
        seoTitle: true,
        seoDescription: true,
        status: true,
        publishAt: true,
        images: { orderBy: { position: "asc" }, take: 1, select: { url: true } },
      },
    }),
    getSettings(),
  ]);

  if (!product || !isProductVisible(product)) {
    return {
      title: "Product Not Found",
      robots: { index: false, follow: false },
    };
  }

  const profile = buildBusinessProfile(settings);
  const siteUrl = getSiteUrl();

  return buildPageMetadata({
    title: product.seoTitle || product.name,
    description: product.seoDescription || product.description || profile.tagline,
    path: `/product/${product.slug}`,
    image: product.images[0]?.url,
    settings,
    siteUrl,
  });
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const resolvedParams = await params;
  const [product, settings, offerBadges] = await Promise.all([
    prisma.product.findUnique({
      where: { slug: resolvedParams.slug },
      include: {
        images: { orderBy: { position: "asc" } },
        variants: true,
        category: true,
        collections: { select: { collectionId: true } },
      },
    }),
    getSettings(),
    getActiveAutomaticOfferBadges(),
  ]);

  if (!product) {
    const slugRedirect = await prisma.productSlugRedirect.findUnique({
      where: { oldSlug: resolvedParams.slug },
      include: {
        product: { select: { slug: true, status: true, publishAt: true } },
      },
    });
    if (slugRedirect && isProductVisible(slugRedirect.product)) {
      permanentRedirect(`/product/${slugRedirect.product.slug}`);
    }
    notFound();
  }

  if (!isProductVisible(product)) notFound();

  const offerBadge = resolveOfferBadge(
    product.id,
    product.categoryId,
    product.collections.map((c) => c.collectionId),
    offerBadges
  );

  const [reviews, ratingAggregate] = await Promise.all([
    getReviewsForProduct(product.id),
    getAverageRating(product.id),
  ]);

  const savings = savingsPaise(product.price, product.compareAtPrice);
  const grouped = groupVariants(
    product.variants.map((v) => ({
      id: v.id,
      size: v.size,
      color: v.color || "",
      colorHex: v.colorHex || null,
      stock: v.stock,
    })),
    product.category?.sizes ?? []
  );
  const defaultColor = grouped.hasColors
    ? pickDefaultVariant(grouped)?.color || grouped.colors[0]?.color || ""
    : "";

  const profile = buildBusinessProfile(settings);
  const brandName = profile.displayName || profile.legalName || settings.businessName;
  const siteUrl = getSiteUrl() || "http://localhost:3000";
  const productUrl = `${siteUrl}/product/${product.slug}`;

  return (
    <main className="px-4 sm:px-7 py-10 max-w-5xl mx-auto">
      <JsonLd
        data={productJsonLd({
          name: product.name,
          description: product.description,
          url: productUrl,
          images: product.images.map((i) => i.url),
          brandName,
          variants: product.variants.map((v) => ({
            pricePaise: product.price,
            stock: v.stock,
            sku: v.sku,
          })),
          returnWindowDays: settings.returnWindowDays,
          freeReturnShipping: settings.freeReturnShipping,
          shippingFeePaise: settings.shippingFee,
          freeShippingOnPrepaid: settings.freeShippingOnPrepaid,
          maxDeliveryDays: settings.maxDeliveryDays,
        })}
      />
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", url: `${siteUrl}/` },
          { name: "Shop", url: `${siteUrl}/shop` },
          { name: product.name, url: productUrl },
        ])}
      />
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
      <TrackViewContentPixel
        productId={product.id}
        productName={product.name}
        priceRupees={product.price / 100}
      />
      <ProductColorProvider initialColor={defaultColor}>
        <div className="grid md:grid-cols-2 gap-8 md:gap-10 items-start">
          <div>
            <ProductImageGallery
              url={product.images[0]?.url}
              images={product.images}
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
            <div className="flex items-center gap-2 shrink-0">
              <WishlistButton productId={product.id} />
              <CareTag>{product.category?.name?.toUpperCase() ?? ""}</CareTag>
            </div>
          </div>

          {offerBadge && (
            <div className="mt-2">
              <span className="inline-block px-2.5 py-0.5 bg-ink text-white text-[11px] font-medium tracking-wide uppercase rounded-sm">
                {offerBadge}
              </span>
            </div>
          )}

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
      </ProductColorProvider>

      {/* Product Reviews & Ratings Section */}
      <ProductReviews productId={product.id} reviews={reviews} />
    </main>
  );
}
