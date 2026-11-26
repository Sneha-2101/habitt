import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { buildBusinessProfile } from "@/lib/site/business";
import { getSiteUrl } from "@/lib/seo/site-url";
import { isIndexingAllowed } from "@/lib/seo/indexing";
import { storefrontProductWhere } from "@/lib/catalog/visibility";
import { buildGoogleFeedXml, type GoogleFeedVariantItem } from "@/lib/seo/feed";

export const dynamic = "force-dynamic";

export async function GET() {
  const settings = await getSettings();
  const siteUrl = getSiteUrl();
  const allowed = isIndexingAllowed({
    seoIndexingEnabled: settings.seoIndexingEnabled ?? false,
    nodeEnv: process.env.NODE_ENV,
    vercelEnv: process.env.VERCEL_ENV,
    siteUrl,
  });

  if (!allowed || !siteUrl) {
    return new NextResponse("Not Found", {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const profile = buildBusinessProfile(settings);
  const products = await prisma.product.findMany({
    where: storefrontProductWhere(),
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      price: true,
      images: { orderBy: { position: "asc" }, take: 1, select: { url: true } },
      variants: {
        select: { id: true, sku: true, stock: true, color: true, size: true },
      },
    },
    orderBy: { updatedAt: "desc" },
  });

  const items: GoogleFeedVariantItem[] = [];
  for (const p of products) {
    const imgUrl = p.images[0]?.url || settings.ogDefaultImageUrl;
    if (!imgUrl) continue;
    for (const v of p.variants) {
      items.push({
        productId: p.id,
        variantId: v.id,
        sku: v.sku,
        title: p.name,
        description: p.description,
        slug: p.slug,
        imageUrl: imgUrl,
        pricePaise: p.price,
        stock: v.stock,
        color: v.color,
        size: v.size,
      });
    }
  }

  const xml = buildGoogleFeedXml({
    items,
    siteUrl,
    displayName: profile.displayName || profile.legalName || settings.businessName,
  });

  return new NextResponse(xml, {
    status: 200,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, s-maxage=3600",
    },
  });
}
