import Link from "next/link";
import { prisma } from "@/lib/prisma";
import AdminOrdersClient from "@/components/AdminOrdersClient";

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; paymentMethod?: string; q?: string }>;
}) {
  const resolvedParams = await searchParams;
  const query = resolvedParams.q?.trim() || "";
  const paymentMethodFilter = resolvedParams.paymentMethod?.trim();

  const whereClause: any = {
    ...(resolvedParams.status ? { status: resolvedParams.status as never } : {}),
    ...(paymentMethodFilter ? { paymentMethod: paymentMethodFilter as never } : {}),
    ...(query
      ? {
          OR: [
            { displayId: { contains: query, mode: "insensitive" } },
            { customerName: { contains: query, mode: "insensitive" } },
            { customerEmail: { contains: query, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const rawOrders = await prisma.order.findMany({
    where: whereClause,
    include: { items: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const orders = rawOrders.map((o) => ({
    id: o.id,
    displayId: o.displayId,
    customerName: o.customerName,
    customerPhone: o.customerPhone,
    customerEmail: o.customerEmail,
    total: o.total,
    status: o.status,
    paymentMethod: o.paymentMethod,
    createdAt: o.createdAt,
    itemCount: o.items.reduce((sum, item) => sum + item.qty, 0),
  }));

  const statuses = ["PENDING", "PAID", "SHIPPED", "DELIVERED", "CANCELLED", "FAILED"];

  return (
    <main className="px-7 py-9 max-w-5xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h1 className="font-display text-2xl font-medium">Orders</h1>
        <form action="/admin/orders" method="GET" className="flex items-center gap-2">
          {resolvedParams.status && <input type="hidden" name="status" value={resolvedParams.status} />}
          <input
            type="text"
            name="q"
            defaultValue={query}
            placeholder="Search by order #, name, email..."
            className="px-3.5 py-1.5 border border-stone bg-white text-xs rounded-sm focus:outline-none focus:border-ink w-64"
          />
          <button type="submit" className="px-3 py-1.5 bg-ink text-paper text-xs font-medium rounded-sm">
            Search
          </button>
          <a
            href={`/api/admin/orders/export${resolvedParams.status ? `?status=${resolvedParams.status}` : ""}${query ? `${resolvedParams.status ? "&" : "?"}q=${encodeURIComponent(query)}` : ""}`}
            className="px-3 py-1.5 border border-stone bg-white text-xs font-medium rounded-sm hover:bg-paper"
          >
            📥 Export CSV
          </a>
          {query && (
            <Link
              href={resolvedParams.status ? `/admin/orders?status=${resolvedParams.status}` : "/admin/orders"}
              className="text-xs text-stone-dark hover:text-ink underline"
            >
              Clear
            </Link>
          )}
        </form>
      </div>

      <div className="flex gap-2 flex-wrap">
        <Link
          href={query ? `/admin/orders?q=${encodeURIComponent(query)}` : "/admin/orders"}
          className={`px-3.5 py-1.5 border text-[12px] tracking-[0.02em] transition-colors ${
            !resolvedParams.status ? "bg-ink text-paper border-ink" : "border-stone hover:border-ink bg-white"
          }`}
        >
          All
        </Link>
        {statuses.map((s) => (
          <Link
            key={s}
            href={`/admin/orders?status=${s}${query ? `&q=${encodeURIComponent(query)}` : ""}`}
            className={`px-3.5 py-1.5 border text-[12px] tracking-[0.02em] transition-colors ${
              resolvedParams.status === s ? "bg-ink text-paper border-ink" : "border-stone hover:border-ink bg-white"
            }`}
          >
            {s}
          </Link>
        ))}
      </div>

      <AdminOrdersClient orders={orders} />
    </main>
  );
}
