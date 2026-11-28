import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { prisma } from "@/lib/prisma";
import { formatINR } from "@/lib/money";
import { getSettings } from "@/lib/settings";
import { buildBusinessProfile } from "@/lib/site/business";
import { getActiveHomeBanners } from "@/lib/content/content";
import { storefrontProductWhere } from "@/lib/catalog/visibility";
import { getSiteUrl } from "@/lib/seo/site-url";
import { buildPageMetadata } from "@/lib/seo/metadata";
import { organizationJsonLd, websiteJsonLd } from "@/lib/seo/jsonld";
import JsonLd from "@/components/seo/JsonLd";
import ProductCard from "@/components/ProductCard";
import RecentlyViewed from "@/components/RecentlyViewed";
import { safeErrorSummary } from "@/lib/log-redact";

export const revalidate = 60;

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSettings();
  const profile = buildBusinessProfile(settings);
  const siteUrl = getSiteUrl();
  const brandName = profile.displayName || profile.legalName || settings.businessName;
  return buildPageMetadata({
    title: brandName,
    description: profile.tagline || brandName,
    path: "/",
    settings,
    siteUrl,
  });
}

export default async function HomePage() {
  const [settings, activeBanners] = await Promise.all([
    getSettings(),
    getActiveHomeBanners().catch(() => []),
  ]);
  const profile = buildBusinessProfile(settings);
  const brandName = profile.displayName || profile.legalName || settings.businessName;
  const siteUrl = getSiteUrl() || "";
  let featured: Awaited<ReturnType<typeof prisma.product.findMany<{
    include: {
      images: true;
      variants: { select: { id: true; size: true; color: true; colorHex: true; stock: true } };
      category: true;
      reviews: { select: { rating: true } };
    };
  }>>> = [];
  try {
    featured = await prisma.product.findMany({
      where: storefrontProductWhere(),
      include: {
        images: true,
        variants: { select: { id: true, size: true, color: true, colorHex: true, stock: true } },
        category: true,
        reviews: { select: { rating: true } },
      },
      take: 8,
      orderBy: { createdAt: "desc" },
    });
  } catch (err) {
    console.error("HomePage products fetch error:", safeErrorSummary(err));
  }

  const shippingText = settings.freeShippingOnPrepaid
    ? `Free shipping on prepaid orders & over ${formatINR(settings.freeShippingThreshold)}.`
    : `Free shipping over ${formatINR(settings.freeShippingThreshold)}.`;

  return (
    <main>
      {siteUrl && (
        <>
          <JsonLd
            data={organizationJsonLd({
              name: brandName,
              legalName: profile.legalName,
              url: siteUrl,
              logo: settings.ogDefaultImageUrl,
              sameAs: [profile.social.instagramUrl, profile.social.facebookUrl],
              email: profile.supportEmail,
              phone: profile.phone,
              address: {
                streetAddress: settings.businessAddressLine1,
                addressLocality: settings.businessCity,
                addressRegion: settings.businessState,
                postalCode: settings.businessPincode,
                addressCountry: "IN",
              },
            })}
          />
          <JsonLd
            data={websiteJsonLd({
              name: brandName,
              url: siteUrl,
            })}
          />
        </>
      )}
      {/* ACTIVE HOME BANNERS OR DEFAULT HERO */}
      {activeBanners.length > 0 ? (
        <section className="px-4 sm:px-7 pt-6 pb-10 space-y-6">
          {activeBanners.map((banner, idx) => (
            <div
              key={banner.id}
              className="relative overflow-hidden border border-stone bg-card"
            >
              <div className="relative w-full h-[320px] sm:h-[420px]">
                <Image
                  src={banner.imageUrl}
                  alt={banner.imageAlt}
                  fill
                  sizes="100vw"
                  priority={idx === 0}
                  className="object-cover"
                />
              </div>
              <div className="p-6 sm:p-8 bg-paper/95 border-t border-stone">
                <h1 className="font-display italic font-medium text-2xl sm:text-4xl text-ink">
                  {banner.heading}
                </h1>
                {banner.subheading && (
                  <p className="mt-2 text-sm text-[#4B473F] max-w-2xl">
                    {banner.subheading}
                  </p>
                )}
                {banner.ctaLabel && banner.ctaHref && (
                  <Link
                    href={banner.ctaHref}
                    className="inline-block mt-4 px-6 py-2.5 bg-ink text-paper text-xs tracking-[0.06em] uppercase hover:opacity-90 transition-opacity"
                  >
                    {banner.ctaLabel}
                  </Link>
                )}
              </div>
            </div>
          ))}
        </section>
      ) : (
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
            {settings.businessName} makes considered basics — heavier fabrics, honest fits, nothing shouting for
            attention. {shippingText}
          </p>
          <Link
            href="/shop"
            className="inline-block mt-8 px-7 py-3 bg-ink text-paper text-[13px] tracking-[0.06em] uppercase hover:opacity-90 transition-opacity"
          >
            SHOP ALL
          </Link>
        </section>
      )}

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
