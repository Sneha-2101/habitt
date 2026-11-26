import type { Metadata } from "next";
import { isIndexingAllowed } from "@/lib/seo/indexing";

export function stripMarkupAndCollapse(input: string | null | undefined): string {
  if (!input) return "";
  return input
    .replace(/<[^>]*>/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[`*_~>#]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function truncateSeoDescription(
  input: string | null | undefined,
  maxLen = 155
): string {
  const clean = stripMarkupAndCollapse(input);
  if (clean.length <= maxLen) return clean;

  const sliced = clean.slice(0, maxLen);
  const lastSpace = sliced.lastIndexOf(" ");
  if (lastSpace > Math.floor(maxLen * 0.5)) {
    return sliced.slice(0, lastSpace).trim();
  }
  return sliced.trim();
}

export interface PageMetadataInput {
  title: string;
  description: string | null | undefined;
  path: string;
  image?: string | null;
  noindex?: boolean;
  settings: {
    seoIndexingEnabled: boolean;
    ogDefaultImageUrl?: string | null;
  };
  siteUrl: string | null;
}

export function buildPageMetadata(input: PageMetadataInput): Metadata {
  const description = truncateSeoDescription(input.description, 155);
  const cleanPath = input.path.split("?")[0] || "/";
  const canonicalUrl = input.siteUrl ? `${input.siteUrl}${cleanPath}` : undefined;
  const ogImage = input.image || input.settings.ogDefaultImageUrl || undefined;

  const allowed = isIndexingAllowed({
    seoIndexingEnabled: input.settings.seoIndexingEnabled,
    nodeEnv: process.env.NODE_ENV,
    vercelEnv: process.env.VERCEL_ENV,
    siteUrl: input.siteUrl,
  });

  const robots =
    input.noindex || !allowed
      ? { index: false, follow: false }
      : { index: true, follow: true };

  return {
    title: input.title,
    description,
    ...(canonicalUrl ? { alternates: { canonical: canonicalUrl } } : {}),
    openGraph: {
      type: "website",
      ...(canonicalUrl ? { url: canonicalUrl } : {}),
      title: input.title,
      description,
      ...(ogImage ? { images: [{ url: ogImage }] } : {}),
    },
    twitter: {
      card: "summary_large_image",
      title: input.title,
      description,
      ...(ogImage ? { images: [ogImage] } : {}),
    },
    robots,
  };
}

export function buildListingMetadata(input: {
  title: string;
  description: string | null | undefined;
  basePath: string;
  hasFiltersOrSort: boolean;
  image?: string | null;
  settings: {
    seoIndexingEnabled: boolean;
    ogDefaultImageUrl?: string | null;
  };
  siteUrl: string | null;
}): Metadata {
  const meta = buildPageMetadata({
    title: input.title,
    description: input.description,
    path: input.basePath,
    image: input.image,
    settings: input.settings,
    siteUrl: input.siteUrl,
  });

  if (input.hasFiltersOrSort) {
    return {
      ...meta,
      robots: { index: false, follow: true },
    };
  }
  return meta;
}
