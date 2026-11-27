import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ForbiddenError, requireRole, UnauthorizedError } from "@/lib/guards";
import { formatIstDate, parseIstDateRange } from "@/lib/admin/reports";
import { getInfluencerStats } from "@/lib/influencers/stats";
import { formatINR } from "@/lib/money";

export const dynamic = "force-dynamic";

export default async function AdminInfluencerDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
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

  const [{ id }, resolvedSearch] = await Promise.all([params, searchParams]);
  const { fromUtc, toUtc, fromIst, toIst } = parseIstDateRange(
    resolvedSearch.from,
    resolvedSearch.to
  );

  const { influencers, orders } = await getInfluencerStats({
    influencerId: id,
    from: fromUtc,
    to: toUtc,
  });

  const influencer = influencers[0];
  if (!influencer) notFound();

  return (
    <main className="px-7 py-9 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center gap-2 text-xs text-stone-dark">
        <Link href="/admin/influencers" className="hover:underline">
          Influencers
        </Link>
        <span>/</span>
        <span className="text-ink font-medium">{influencer.name}</span>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-medium text-ink">
            {influencer.name}{" "}
            <span className="font-mono text-base text-stone-dark">({influencer.code})</span>
          </h1>
          <p className="text-xs text-stone-dark mt-1">
            {influencer.discountPercent
              ? `${influencer.discountPercent}% coupon`
              : "Tracking only"}{" "}
            · {influencer.active ? "Active" : "Inactive"}
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
            href={`/api/admin/influencers/export?id=${influencer.id}&from=${fromIst}&to=${toIst}`}
            className="px-3.5 py-1.5 border border-ink text-ink text-xs uppercase tracking-wider hover:bg-ink hover:text-paper transition-colors"
          >
            Download CSV
          </Link>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs">
        <div className="border border-stone bg-card p-3">
          <div className="text-stone-dark uppercase text-[10.5px]">Orders Placed</div>
          <div className="font-mono text-lg font-medium mt-1">
            {influencer.summary.ordersPlaced}
          </div>
        </div>
        <div className="border border-stone bg-card p-3">
          <div className="text-stone-dark uppercase text-[10.5px]">Orders Delivered</div>
          <div className="font-mono text-lg font-medium mt-1">
            {influencer.summary.ordersDelivered}
          </div>
        </div>
        <div className="border border-stone bg-card p-3">
          <div className="text-stone-dark uppercase text-[10.5px]">Goods Sales</div>
          <div className="font-mono text-lg font-medium mt-1">
            {formatINR(influencer.summary.goodsSalesPaise)}
          </div>
        </div>
        <div className="border border-stone bg-card p-3">
          <div className="text-stone-dark uppercase text-[10.5px]">Refunded Goods</div>
          <div className="font-mono text-lg font-medium mt-1">
            {formatINR(influencer.summary.refundedGoodsPaise)}
          </div>
        </div>
        <div className="border border-stone bg-card p-3">
          <div className="text-stone-dark uppercase text-[10.5px]">Net Goods</div>
          <div className="font-mono text-lg font-medium mt-1">
            {formatINR(influencer.summary.netGoodsPaise)}
          </div>
        </div>
      </div>

      {/* Attributed Orders Table (no customer PII) */}
      <div className="border border-stone bg-card overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-stone bg-paper text-[11px] uppercase tracking-wider text-stone-dark">
            <tr>
              <th className="p-3">Order</th>
              <th className="p-3">Date (IST)</th>
              <th className="p-3">Payment</th>
              <th className="p-3">Fulfilment</th>
              <th className="p-3 text-right">Goods Net</th>
              <th className="p-3 text-right">Refunded Goods</th>
              <th className="p-3">Source</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone/50">
            {orders.length === 0 && (
              <tr>
                <td colSpan={7} className="p-6 text-center text-stone-dark">
                  No attributed orders in this date range.
                </td>
              </tr>
            )}
            {orders.map((o) => (
              <tr key={o.orderId}>
                <td className="p-3 font-mono">
                  <Link href={`/admin/orders/${o.orderId}`} className="underline text-ink">
                    #{o.orderNumber}
                  </Link>
                  {o.isSelfOrder && (
                    <span className="ml-2 px-1.5 py-0.5 bg-amber-50 border border-amber-200 text-amber-800 text-[10px] uppercase">
                      self-order
                    </span>
                  )}
                </td>
                <td className="p-3 font-mono">{formatIstDate(o.createdAt)}</td>
                <td className="p-3 font-mono">{o.paymentStatus}</td>
                <td className="p-3 font-mono">{o.fulfilmentStatus}</td>
                <td className="p-3 text-right font-mono">{formatINR(o.goodsNetPaise)}</td>
                <td className="p-3 text-right font-mono">{formatINR(o.refundedGoodsPaise)}</td>
                <td className="p-3 font-mono">{o.source || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
