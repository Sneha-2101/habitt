import type { MetadataRoute } from "next";
import { getSettings } from "@/lib/settings";
import { getSiteUrl } from "@/lib/seo/site-url";
import { isIndexingAllowed } from "@/lib/seo/indexing";

export const dynamic = "force-dynamic";

export default async function robots(): Promise<MetadataRoute.Robots> {
  const settings = await getSettings();
  const siteUrl = getSiteUrl();
  const allowed = isIndexingAllowed({
    seoIndexingEnabled: settings.seoIndexingEnabled ?? false,
    nodeEnv: process.env.NODE_ENV,
    vercelEnv: process.env.VERCEL_ENV,
    siteUrl,
  });

  if (!allowed) {
    return {
      rules: [
        {
          userAgent: "*",
          disallow: "/",
        },
      ],
    };
  }

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/admin",
          "/api",
          "/checkout",
          "/account",
          "/staff",
          "/login",
          "/cart",
          "/offline",
          "/r/",
          "/i/",
          "/ticket/",
          "/order/",
          "/wantlist",
        ],
      },
    ],
    ...(siteUrl ? { sitemap: `${siteUrl}/sitemap.xml` } : {}),
  };
}
