import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatINR } from "@/lib/money";

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const resolvedParams = await searchParams;
  const orders = await prisma.order.findMany({
    where: resolvedParams.status ? { status: resolvedParams.status as never } : {},
    include: { items: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const statuses = ["PENDING", "PAID", "SHIPPED", "DELIVERED", "CANCELLED", "FAILED"];

  return (
    <main className="px-7 py-9 max-w-5xl mx-auto">
      <h1 className="font-display text-2xl font-medium mb-6">Orders</h1>

      <div className="flex gap-2 flex-wrap mb-6">
        <Link
          href="/admin/orders"
          className={`px-3.5 py-1.5 border text-[12px] tracking-[0.02em] transition-colors ${
            !resolvedParams.status ? "bg-ink text-paper border-ink" : "border-stone hover:border-ink"
          }`}
        >
          All
        </Link>
        {statuses.map((s) => (
          <Link
            key={s}
            href={`/admin/orders?status=${s}`}
            className={`px-3.5 py-1.5 border text-[12px] tracking-[0.02em] transition-colors ${
              resolvedParams.status === s ? "bg-ink text-paper border-ink" : "border-stone hover:border-ink"
            }`}
          >
            {s}
          </Link>
        ))}
      </div>

      <div className="border border-stone bg-card">
        <div className="grid grid-cols-[1.5fr_2fr_1fr_1fr_1fr] px-3.5 py-2.5 text-[11px] tracking-[0.06em] text-stone-dark border-b border-stone font-mono uppercase">
          <span>ORDER ID</span>
          <span>CUSTOMER</span>
          <span>ITEMS</span>
          <span>TOTAL</span>
          <span>STATUS</span>
        </div>
        {orders.map((o) => {
          const itemCount = o.items.reduce((sum, item) => sum + item.qty, 0);
          return (
            <Link
              key={o.id}
              href={`/admin/orders/${o.id}`}
              className="grid grid-cols-[1.5fr_2fr_1fr_1fr_1fr] px-3.5 py-3 text-[13px] items-center border-b border-stone last:border-0 hover:bg-paper/50 transition-colors"
            >
              <span className="font-mono">{o.displayId}</span>
              <span>{o.customerName}</span>
              <span className="font-mono text-[12.5px]">{itemCount}</span>
              <span className="font-mono text-[12.5px]">{formatINR(o.total)}</span>
              <span
                className={`text-[12.5px] font-medium ${
                  o.status === "PAID" || o.status === "DELIVERED"
                    ? "text-moss"
                    : o.status === "FAILED" || o.status === "CANCELLED"
                    ? "text-clay"
                    : "text-ink"
                }`}
              >
                {o.status}
              </span>
            </Link>
          );
        })}
        {orders.length === 0 && <p className="px-3.5 py-8 text-sm text-stone-dark text-center">No orders found.</p>}
      </div>
    </main>
  );
}
