import React from "react";
import Link from "next/link";
import { CareTag } from "@/components/CareTag";
import { ContentBlocks } from "@/components/ContentBlocks";
import { getBusinessProfile } from "@/lib/site/business";
import { getContent } from "@/lib/content/content";
import { getSettings } from "@/lib/settings";
import { buildPageMetadata } from "@/lib/seo/metadata";
import { getSiteUrl } from "@/lib/seo/site-url";

export const revalidate = 3600;

export async function generateMetadata() {
  const [settings, profile, siteUrl] = await Promise.all([
    getSettings(),
    getBusinessProfile(),
    Promise.resolve(getSiteUrl()),
  ]);
  const brand = profile.displayName || profile.legalName || "About";
  return buildPageMetadata({
    title: `About ${brand}`,
    description: `Learn more about ${brand}, our materials, craftsmanship, and brand story.`,
    path: "/about",
    settings,
    siteUrl,
  });
}

export default async function AboutPage() {
  const [profile, content] = await Promise.all([
    getBusinessProfile(),
    getContent("about").catch(() => null),
  ]);

  const hasPublishedCustom = Boolean(content?.isPublished && content.body.trim().length > 0);
  const brandName = profile.displayName || profile.legalName || "";

  if (hasPublishedCustom && content) {
    return (
      <main className="px-4 sm:px-7 py-12 md:py-20 max-w-4xl mx-auto">
        <div className="border-b border-stone pb-8 mb-8">
          <CareTag>ABOUT</CareTag>
          <h1 className="font-display italic text-4xl sm:text-5xl font-medium leading-[1.08] mt-4">
            {content.title || brandName || "About Us"}
          </h1>
        </div>
        <ContentBlocks
          body={content.body}
          className="space-y-4 text-[15px] text-[#4B473F] leading-relaxed"
        />
        <div className="mt-10">
          <Link
            href="/shop"
            className="inline-block px-7 py-3 bg-ink text-paper text-[12.5px] tracking-[0.06em] uppercase hover:opacity-90 transition-opacity"
          >
            EXPLORE THE COLLECTION
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="px-4 sm:px-7 py-12 md:py-20 max-w-4xl mx-auto">
      <div className="border-b border-stone pb-10 mb-12">
        <CareTag>OUR PHILOSOPHY</CareTag>
        <h1 className="font-display italic text-4xl sm:text-5xl md:text-6xl font-medium leading-[1.08] mt-4 mb-6">
          {profile.tagline || "Clothes with a quiet weight to them."}
        </h1>
        {brandName && (
          <p className="text-lg md:text-xl text-[#4B473F] leading-relaxed max-w-2xl">
            {brandName} makes considered everyday garments built to endure beyond seasonal noise.
          </p>
        )}
      </div>

      <Link
        href="/shop"
        className="inline-block px-7 py-3 bg-ink text-paper text-[12.5px] tracking-[0.06em] uppercase hover:opacity-90 transition-opacity"
      >
        EXPLORE THE COLLECTION
      </Link>
    </main>
  );
}
