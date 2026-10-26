import { prisma } from "@/lib/prisma";
import { formatINR } from "@/lib/money";
import { getSettings } from "@/lib/settings";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function AdminDashboard() {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const settings = await getSettings();

  let ordersToday = 0;
  let weekOrders: any[] = [];
  let lowStock: any[] = [];
  let pendingReturns = 0;

  try {
    const res = await Promise.all([
      prisma.order.count({ where: { createdAt: { gte: startOfToday }, status: "PAID" } }),
      prisma.order.findMany({ where: { createdAt: { gte: sevenDaysAgo }, status: "PAID" } }),
      prisma.productVariant.findMany({
        where: { stock: { lte: settings.lowStockThreshold } },
        include: { product: true },
        take: 10,
      }),
      prisma.returnRequest.count({ where: { status: "REQUESTED" } }),
    ]);
    ordersToday = res[0];
    weekOrders = res[1];
    lowStock = res[2];
    pendingReturns = res[3];
  } catch (err) {
    console.error("AdminDashboard query error:", err);
  }

  const weekRevenue = weekOrders.reduce((sum, o) => sum + o.total, 0);

  return (
    <main className="px-7 py-9 max-w-5xl mx-auto">
      <h1 className="font-display text-2xl mb-7">Dashboard</h1>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
        <div className="border border-stone p-5 bg-white">
          <div className="text-[11px] tracking-[0.06em] text-stone-dark mb-2">ORDERS TODAY</div>
          <div className="font-mono text-2xl">{ordersToday}</div>
        </div>
        <div className="border border-stone p-5 bg-white">
          <div className="text-[11px] tracking-[0.06em] text-stone-dark mb-2">REVENUE (7D)</div>
          <div className="font-mono text-2xl">{formatINR(weekRevenue)}</div>
        </div>
        <div className="border border-stone p-5 bg-white">
          <div className="text-[11px] tracking-[0.06em] text-stone-dark mb-2">LOW STOCK</div>
          <div className="font-mono text-2xl">{lowStock.length}</div>
        </div>
        <div className="border border-stone p-5 bg-white">
          <div className="text-[11px] tracking-[0.06em] text-stone-dark mb-2">PENDING RETURNS</div>
          <div className="font-mono text-2xl text-amber-700">{pendingReturns}</div>
        </div>
      </div>

      {lowStock.length > 0 && (
        <div className="mb-8">
          <h2 className="text-sm font-medium mb-3">Low stock</h2>
          <div className="border border-stone bg-white">
            {lowStock.map((v) => (
              <div key={v.id} className="flex justify-between px-4 py-3 text-[13px] border-b border-stone last:border-0">
                <span>{v.product.name} — {v.size}</span>
                <span className="text-clay font-medium">{v.stock} left</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-3 mt-8">
        <Link href="/admin/products" className="px-4 py-2.5 border border-ink text-[12.5px] bg-white hover:bg-paper">
          Manage products
        </Link>
        <Link href="/admin/orders" className="px-4 py-2.5 border border-ink text-[12.5px] bg-white hover:bg-paper">
          Manage orders
        </Link>
        <Link href="/admin/returns" className="px-4 py-2.5 border border-ink text-[12.5px] bg-white hover:bg-paper font-medium text-amber-800">
          Return requests ({pendingReturns})
        </Link>
        <Link href="/admin/settings" className="px-4 py-2.5 border border-ink text-[12.5px] bg-white hover:bg-paper font-medium">
          Store settings
        </Link>
      </div>
    </main>
  );
}
