import type { MetadataRoute } from "next";
import { prisma } from "@/lib/prisma";
import { getSiteUrl } from "@/lib/seo/site-url";
import { storefrontProductWhere } from "@/lib/catalog/visibility";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = getSiteUrl() || "http://localhost:3000";

  const [products, aboutContent] = await Promise.all([
    prisma.product.findMany({
      where: storefrontProductWhere(),
      select: { slug: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
      take: 44990,
    }),
    prisma.siteContent.findUnique({
      where: { key: "about" },
      select: { isPublished: true, updatedAt: true },
    }),
  ]);

  const entries: MetadataRoute.Sitemap = [
    { url: `${baseUrl}/`, changeFrequency: "daily", priority: 1.0 },
    { url: `${baseUrl}/shop`, changeFrequency: "daily", priority: 0.9 },
    ...(aboutContent === null || aboutContent.isPublished
      ? [
          {
            url: `${baseUrl}/about`,
            lastModified: aboutContent?.updatedAt,
            changeFrequency: "monthly" as const,
            priority: 0.5,
          },
        ]
      : []),
    { url: `${baseUrl}/contact`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${baseUrl}/support`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${baseUrl}/policies/shipping`, changeFrequency: "monthly", priority: 0.4 },
    { url: `${baseUrl}/policies/returns`, changeFrequency: "monthly", priority: 0.4 },
    { url: `${baseUrl}/policies/privacy`, changeFrequency: "monthly", priority: 0.3 },
    { url: `${baseUrl}/policies/terms`, changeFrequency: "monthly", priority: 0.3 },
    { url: `${baseUrl}/policies/grievance`, changeFrequency: "monthly", priority: 0.3 },
  ];

  for (const p of products) {
    entries.push({
      url: `${baseUrl}/product/${p.slug}`,
      lastModified: p.updatedAt,
      changeFrequency: "weekly",
      priority: 0.8,
    });
  }

  return entries.slice(0, 45000);
}
