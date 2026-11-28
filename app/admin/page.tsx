import Link from "next/link";
import { formatINR } from "@/lib/money";
import { getDashboardStats } from "@/lib/admin/dashboard";

export const dynamic = "force-dynamic";

export default async function AdminDashboard() {
  const stats = await getDashboardStats();

  return (
    <main className="px-7 py-9 max-w-5xl mx-auto">
      <div className="flex justify-between items-center mb-7">
        <h1 className="font-display text-2xl font-medium">Dashboard</h1>
        <div className="flex gap-2">
          <Link
            href="/admin/orders"
            className="px-3.5 py-1.5 border border-stone bg-white text-xs font-mono uppercase tracking-wider hover:bg-paper"
          >
            Orders
          </Link>
          <Link
            href="/admin/tickets"
            className="px-3.5 py-1.5 border border-stone bg-white text-xs font-mono uppercase tracking-wider hover:bg-paper"
          >
            Tickets
          </Link>
          <Link
            href="/admin/returns"
            className="px-3.5 py-1.5 border border-stone bg-white text-xs font-mono uppercase tracking-wider hover:bg-paper"
          >
            Returns
          </Link>
          <Link
            href="/admin/reports"
            className="px-3.5 py-1.5 border border-stone bg-white text-xs font-mono uppercase tracking-wider hover:bg-paper"
          >
            Reports
          </Link>
        </div>
      </div>

      {/* KPI TILES GRID */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 mb-8">
        <Link
          href="/admin/orders"
          className="border border-stone p-4 bg-white hover:border-ink transition-colors block"
        >
          <div className="text-[11px] tracking-[0.06em] text-stone-dark mb-1 font-mono uppercase">
            Orders to Ship
          </div>
          <div className="font-mono text-2xl text-ink">{stats.ordersToShip}</div>
          <div className="text-[10.5px] text-stone-dark mt-1">Paid / COD confirmed</div>
        </Link>

        <Link
          href="/admin/orders?status=SHIPPED"
          className="border border-stone p-4 bg-white hover:border-ink transition-colors block"
        >
          <div className="text-[11px] tracking-[0.06em] text-stone-dark mb-1 font-mono uppercase">
            Shipped (7d)
          </div>
          <div className="font-mono text-2xl text-ink">{stats.shipped7d}</div>
          <div className="text-[10.5px] text-stone-dark mt-1">In transit</div>
        </Link>

        <Link
          href="/admin/orders?status=DELIVERED"
          className="border border-stone p-4 bg-white hover:border-ink transition-colors block"
        >
          <div className="text-[11px] tracking-[0.06em] text-stone-dark mb-1 font-mono uppercase">
            Delivered (7d)
          </div>
          <div className="font-mono text-2xl text-moss font-medium">{stats.delivered7d}</div>
          <div className="text-[10.5px] text-stone-dark mt-1">Completed delivery</div>
        </Link>

        <Link
          href="/admin/orders"
          className="border border-stone p-4 bg-white hover:border-ink transition-colors block"
        >
          <div className="text-[11px] tracking-[0.06em] text-stone-dark mb-1 font-mono uppercase">
            Revenue (Today)
          </div>
          <div className="font-mono text-2xl text-ink">{formatINR(stats.revenueToday)}</div>
          <div className="text-[10.5px] text-stone-dark mt-1">Settled payments</div>
        </Link>

        <Link
          href="/admin/orders"
          className="border border-stone p-4 bg-white hover:border-ink transition-colors block"
        >
          <div className="text-[11px] tracking-[0.06em] text-stone-dark mb-1 font-mono uppercase">
            Revenue (7d)
          </div>
          <div className="font-mono text-2xl text-ink">{formatINR(stats.revenue7d)}</div>
          <div className="text-[10.5px] text-stone-dark mt-1">Trailing 7 days</div>
        </Link>

        <Link
          href="/admin/returns"
          className="border border-stone p-4 bg-white hover:border-ink transition-colors block"
        >
          <div className="text-[11px] tracking-[0.06em] text-stone-dark mb-1 font-mono uppercase">
            Pending Returns
          </div>
          <div className={`font-mono text-2xl ${stats.pendingReturns > 0 ? "text-amber-800" : "text-ink"}`}>
            {stats.pendingReturns}
          </div>
          <div className="text-[10.5px] text-stone-dark mt-1">Requested / Approved</div>
        </Link>

        <Link
          href="/admin/returns"
          className="border border-stone p-4 bg-white hover:border-ink transition-colors block"
        >
          <div className="text-[11px] tracking-[0.06em] text-stone-dark mb-1 font-mono uppercase">
            Return SLA (&gt;36h)
          </div>
          <div className={`font-mono text-2xl ${stats.returnsSlaBreach > 0 ? "text-clay font-bold" : "text-ink"}`}>
            {stats.returnsSlaBreach}
          </div>
          <div className="text-[10.5px] text-stone-dark mt-1">Needs review</div>
        </Link>

        <Link
          href="/admin/tickets"
          className="border border-stone p-4 bg-white hover:border-ink transition-colors block"
        >
          <div className="text-[11px] tracking-[0.06em] text-stone-dark mb-1 font-mono uppercase">
            Open Tickets
          </div>
          <div className="font-mono text-2xl text-ink">{stats.openTickets}</div>
          <div className="text-[10.5px] text-stone-dark mt-1">Support queue</div>
        </Link>

        <Link
          href="/admin/tickets?overdue=ack"
          className="border border-stone p-4 bg-white hover:border-ink transition-colors block"
        >
          <div className="text-[11px] tracking-[0.06em] text-stone-dark mb-1 font-mono uppercase">
            Overdue Tickets
          </div>
          <div className={`font-mono text-2xl ${stats.overdueTickets > 0 ? "text-clay font-bold" : "text-ink"}`}>
            {stats.overdueTickets}
          </div>
          <div className="text-[10.5px] text-stone-dark mt-1">Ack or resolve breach</div>
        </Link>

        <Link
          href="/admin/jobs"
          className="border border-stone p-4 bg-white hover:border-ink transition-colors block"
        >
          <div className="text-[11px] tracking-[0.06em] text-stone-dark mb-1 font-mono uppercase">
            Failed Outbox
          </div>
          <div className={`font-mono text-2xl ${stats.failedOutbox > 0 ? "text-clay font-bold" : "text-ink"}`}>
            {stats.failedOutbox}
          </div>
          <div className="text-[10.5px] text-stone-dark mt-1">Dead-letter events</div>
        </Link>

        <Link
          href="/admin/reports?tab=sales"
          className="border border-stone p-4 bg-white hover:border-ink transition-colors block"
        >
          <div className="text-[11px] tracking-[0.06em] text-stone-dark mb-1 font-mono uppercase">
            Business Reports
          </div>
          <div className="font-mono text-xl text-ink font-medium">Sales & Trends</div>
          <div className="text-[10.5px] text-stone-dark mt-1">Settled turnover & net</div>
        </Link>

        <Link
          href="/admin/reports?tab=gst"
          className="border border-stone p-4 bg-white hover:border-ink transition-colors block"
        >
          <div className="text-[11px] tracking-[0.06em] text-stone-dark mb-1 font-mono uppercase">
            Tax Compliance
          </div>
          <div className="font-mono text-xl text-ink font-medium">GST Summary</div>
          <div className="text-[10.5px] text-stone-dark mt-1">Turnover & reverse tax</div>
        </Link>
      </div>

      {/* INFORMATIONAL CRON STALENESS BOX */}
      {stats.staleCrons.length > 0 && (
        <div className="mb-8 p-4 bg-amber-50 border border-amber-200 text-xs">
          <div className="font-mono uppercase font-semibold text-amber-900 mb-1">
            System Alert: Cron Schedules Requiring Attention
          </div>
          <ul className="list-disc pl-5 space-y-0.5 text-amber-800 font-mono">
            {stats.staleCrons.map((c) => (
              <li key={c.jobName}>
                <strong>{c.jobName}</strong>: {c.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* LOW STOCK SECTION (GROUPED BY PRODUCT THEN COLOR) */}
      <div className="mb-8">
        <div className="flex justify-between items-center mb-3">
          <h2 className="text-sm font-medium">
            Low Stock Variants (≤ {stats.lowStockThreshold} units)
          </h2>
          <span className="text-xs text-stone-dark font-mono">
            Threshold: {stats.lowStockThreshold}
          </span>
        </div>

        {stats.lowStockGroups.length > 0 ? (
          <div className="border border-stone bg-white divide-y divide-stone">
            {stats.lowStockGroups.map((group) => (
              <div key={`${group.productId}-${group.color}`} className="p-4">
                <div className="flex justify-between items-center mb-2">
                  <div className="font-medium text-xs text-ink">
                    <Link
                      href={`/admin/products/${group.productId}/edit`}
                      className="underline hover:text-moss"
                    >
                      {group.productName}
                    </Link>
                    <span className="text-stone-dark ml-2">
                      Color: {group.color}
                    </span>
                  </div>
                  <Link
                    href={`/admin/products/${group.productId}/edit`}
                    className="text-[11px] text-moss uppercase tracking-wider font-mono hover:underline"
                  >
                    Edit Product →
                  </Link>
                </div>
                <div className="flex flex-wrap gap-2">
                  {group.items.map((item) => (
                    <span
                      key={item.variantId}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 border border-stone/60 bg-paper text-xs font-mono"
                    >
                      <span>Size {item.size}:</span>
                      <strong className={item.stock === 0 ? "text-clay" : "text-amber-800"}>
                        {item.stock} left
                      </strong>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="border border-stone bg-white p-6 text-center text-xs text-stone-dark font-mono">
            All variants are well-stocked above threshold ({stats.lowStockThreshold}).
          </div>
        )}
      </div>

      {/* QUICK LINKS */}
      <div className="flex flex-wrap gap-3 mt-6 pt-6 border-t border-stone/50">
        <Link href="/admin/products" className="px-4 py-2 border border-ink text-xs bg-white hover:bg-paper">
          Manage Products
        </Link>
        <Link href="/admin/categories" className="px-4 py-2 border border-ink text-xs bg-white hover:bg-paper">
          Categories &amp; Sizes
        </Link>
        <Link href="/admin/coupons" className="px-4 py-2 border border-ink text-xs bg-white hover:bg-paper">
          Coupons
        </Link>
        <Link href="/admin/settings" className="px-4 py-2 border border-ink text-xs bg-white hover:bg-paper">
          Store Settings
        </Link>
      </div>
    </main>
  );
}
