import { prisma } from "@/lib/prisma";
import { formatINR } from "@/lib/money";
import Link from "next/link";

export default async function AdminDashboard() {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [ordersToday, weekOrders, lowStock] = await Promise.all([
    prisma.order.count({ where: { createdAt: { gte: startOfToday }, status: "PAID" } }),
    prisma.order.findMany({ where: { createdAt: { gte: sevenDaysAgo }, status: "PAID" } }),
    prisma.productVariant.findMany({
      where: { stock: { lt: 6 } },
      include: { product: true },
      take: 10,
    }),
  ]);

  const weekRevenue = weekOrders.reduce((sum, o) => sum + o.total, 0);

  return (
    <main className="px-7 py-9 max-w-5xl mx-auto">
      <h1 className="font-display text-2xl mb-7">Dashboard</h1>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-10">
        <div className="border border-stone p-5">
          <div className="text-[11px] tracking-[0.06em] text-stone-dark mb-2">ORDERS TODAY</div>
          <div className="font-mono text-2xl">{ordersToday}</div>
        </div>
        <div className="border border-stone p-5">
          <div className="text-[11px] tracking-[0.06em] text-stone-dark mb-2">REVENUE (7D)</div>
          <div className="font-mono text-2xl">{formatINR(weekRevenue)}</div>
        </div>
        <div className="border border-stone p-5">
          <div className="text-[11px] tracking-[0.06em] text-stone-dark mb-2">LOW STOCK</div>
          <div className="font-mono text-2xl">{lowStock.length}</div>
        </div>
      </div>

      {lowStock.length > 0 && (
        <div>
          <h2 className="text-sm font-medium mb-3">Low stock</h2>
          <div className="border border-stone">
            {lowStock.map((v) => (
              <div key={v.id} className="flex justify-between px-4 py-3 text-[13px] border-b border-stone last:border-0">
                <span>{v.product.name} — {v.size}</span>
                <span className="text-clay">{v.stock} left</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-3 mt-8">
        <Link href="/admin/products" className="px-4 py-2.5 border border-ink text-[12.5px]">Manage products</Link>
        <Link href="/admin/orders" className="px-4 py-2.5 border border-ink text-[12.5px]">Manage orders</Link>
      </div>
    </main>
  );
}
