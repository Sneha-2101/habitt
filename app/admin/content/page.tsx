import { listAllBanners, listContent } from "@/lib/content/content";
import ContentAdminClient from "./ContentAdminClient";

export const dynamic = "force-dynamic";

export default async function AdminContentPage() {
  const [banners, contents] = await Promise.all([listAllBanners(), listContent()]);

  return (
    <main className="px-7 py-9 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="font-display text-2xl font-medium text-ink">Storefront Content & Banners</h1>
        <p className="text-xs text-stone-dark mt-1">
          Manage homepage banners, the About page, and supplementary notes appended to policy pages.
        </p>
      </div>

      <ContentAdminClient
        initialBanners={banners.map((b) => ({
          id: b.id,
          imageUrl: b.imageUrl,
          imageAlt: b.imageAlt,
          heading: b.heading,
          subheading: b.subheading,
          ctaLabel: b.ctaLabel,
          ctaHref: b.ctaHref,
          sortOrder: b.sortOrder,
          isActive: b.isActive,
          startsAt: b.startsAt ? b.startsAt.toISOString() : null,
          endsAt: b.endsAt ? b.endsAt.toISOString() : null,
        }))}
        initialContents={contents.map((c) => ({
          key: c.key,
          title: c.title,
          body: c.body,
          isPublished: c.isPublished,
        }))}
      />
    </main>
  );
}
