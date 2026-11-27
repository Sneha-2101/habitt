import Link from "next/link";
import { redirect } from "next/navigation";
import { ForbiddenError, requireRole, UnauthorizedError } from "@/lib/guards";
import { parseIstDateRange } from "@/lib/admin/reports";
import { getInfluencerStats } from "@/lib/influencers/stats";
import { getSettings } from "@/lib/settings";
import { getSiteUrl } from "@/lib/seo/site-url";
import InfluencersClient from "./InfluencersClient";

export const dynamic = "force-dynamic";

export default async function AdminInfluencersPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  try {
    await requireRole("OWNER");
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      redirect("/staff/login");
    }
    if (err instanceof ForbiddenError) {
      redirect("/admin");
    }
    throw err;
  }

  const resolved = await searchParams;
  const { fromUtc, toUtc, fromIst, toIst } = parseIstDateRange(
    resolved.from,
    resolved.to
  );

  const [{ influencers }, settings] = await Promise.all([
    getInfluencerStats({ from: fromUtc, to: toUtc }),
    getSettings(),
  ]);

  const siteUrl = getSiteUrl();

  return (
    <main className="px-7 py-9 max-w-6xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-medium text-ink">Influencers</h1>
          <p className="text-xs text-stone-dark mt-1">
            Track attributed orders and goods revenue by coupon code or link.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <form method="GET" className="flex items-center gap-2 text-xs">
            <input
              type="date"
              name="from"
              defaultValue={fromIst}
              className="px-2.5 py-1.5 border border-stone bg-card font-mono text-xs"
            />
            <span className="text-stone-dark">to</span>
            <input
              type="date"
              name="to"
              defaultValue={toIst}
              className="px-2.5 py-1.5 border border-stone bg-card font-mono text-xs"
            />
            <button
              type="submit"
              className="px-3 py-1.5 bg-ink text-paper text-xs uppercase tracking-wider"
            >
              Filter
            </button>
          </form>

          <Link
            href={`/api/admin/influencers/export?from=${fromIst}&to=${toIst}`}
            className="px-3.5 py-1.5 border border-ink text-ink text-xs uppercase tracking-wider hover:bg-ink hover:text-paper transition-colors"
          >
            Download CSV
          </Link>
        </div>
      </div>

      <InfluencersClient
        influencers={influencers}
        initialCookieDays={settings.influencerCookieDays ?? 30}
        siteUrl={siteUrl}
        fromIst={fromIst}
        toIst={toIst}
      />
    </main>
  );
}
