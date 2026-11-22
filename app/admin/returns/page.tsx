import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatINR } from "@/lib/money";
import { approveReturn, rejectReturn } from "@/lib/actions/returns";
import { requireStaff } from "@/lib/guards";
import type { ReturnStatus } from "@prisma/client";

export default async function AdminReturnsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  await requireStaff();
  const resolvedParams = await searchParams;
  const statusFilter = resolvedParams.status as ReturnStatus | undefined;

  const returnRequests = await prisma.returnRequest.findMany({
    where: statusFilter ? { status: statusFilter } : {},
    include: {
      order: {
        select: {
          id: true,
          displayId: true,
          total: true,
          paymentStatus: true,
          fulfilmentStatus: true,
          paymentMethod: true,
        },
      },
      user: { select: { name: true, email: true, phone: true } },
      items: {
        select: {
          id: true,
          qty: true,
          orderItem: { select: { name: true, size: true, unitPrice: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const statuses: ReturnStatus[] = [
    "REQUESTED",
    "APPROVED",
    "RECEIVED",
    "REFUNDED",
    "REJECTED",
    "CANCELLED",
  ];

  const now = Date.now();
  const SLA_MS = 36 * 60 * 60 * 1000;

  return (
    <main className="px-7 py-9 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-medium">Return Requests Queue</h1>
          <p className="text-xs text-stone-dark mt-0.5">
            Manage customer return requests, inspections, and refund disbursements.
          </p>
        </div>
        <Link href="/admin/orders" className="text-xs text-stone-dark hover:text-ink underline">
          ← Back to Orders
        </Link>
      </div>

      {/* Status Filter Tabs */}
      <div className="flex gap-2 flex-wrap">
        <Link
          href="/admin/returns"
          className={`px-3.5 py-1.5 border text-[12px] tracking-[0.02em] transition-colors ${
            !statusFilter ? "bg-ink text-paper border-ink" : "border-stone hover:border-ink bg-white"
          }`}
        >
          All
        </Link>
        {statuses.map((s) => (
          <Link
            key={s}
            href={`/admin/returns?status=${s}`}
            className={`px-3.5 py-1.5 border text-[12px] tracking-[0.02em] transition-colors ${
              statusFilter === s ? "bg-ink text-paper border-ink" : "border-stone hover:border-ink bg-white"
            }`}
          >
            {s}
          </Link>
        ))}
      </div>

      {/* Return Requests List */}
      <div className="border border-stone bg-white rounded-sm divide-y divide-stone">
        {returnRequests.map((req) => {
          // 48h clock SLA check: approved or received with no refund initiated for > 36h
          const isAwaitingRefund =
            (req.status === "APPROVED" || req.status === "RECEIVED") &&
            !req.refundInitiatedAt;
          const relevantTimestamp = req.approvedAt || req.receivedAt || req.updatedAt;
          const isSlaBreached =
            isAwaitingRefund && now - new Date(relevantTimestamp).getTime() > SLA_MS;

          return (
            <div key={req.id} className="p-5 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[13px]">
                <div>
                  <div className="flex items-center gap-3">
                    <Link
                      href={`/admin/returns/${req.id}`}
                      className="font-mono font-medium text-ink hover:underline"
                    >
                      Return #{req.id.slice(-8)}
                    </Link>
                    <Link
                      href={`/admin/orders/${req.order.id}`}
                      className="text-xs text-stone-dark hover:underline font-mono"
                    >
                      (Order #{req.order.displayId})
                    </Link>
                    <span className="font-mono text-stone-dark">
                      {formatINR(req.order.total)}
                    </span>
                    <span
                      className={`text-xs font-semibold px-2 py-0.5 rounded ${
                        req.status === "REFUNDED"
                          ? "bg-emerald-100 text-emerald-800"
                          : req.status === "REJECTED" || req.status === "CANCELLED"
                          ? "bg-stone-200 text-stone-700"
                          : req.status === "RECEIVED"
                          ? "bg-indigo-100 text-indigo-800"
                          : "bg-amber-100 text-amber-800"
                      }`}
                    >
                      {req.status}
                    </span>
                    {isSlaBreached && (
                      <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-red-600 text-white animate-pulse">
                        SLA &gt; 36h
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-stone-dark mt-1">
                    Customer: {req.user.name} ({req.user.email}) ·{" "}
                    {new Date(req.createdAt).toLocaleString("en-IN")}
                  </p>
                </div>

                <div>
                  <Link
                    href={`/admin/returns/${req.id}`}
                    className="text-xs font-medium text-ink border border-stone px-3 py-1.5 rounded hover:bg-stone/10 transition-colors"
                  >
                    View Details & Action →
                  </Link>
                </div>
              </div>

              {/* Items Summary */}
              <div className="p-3 bg-paper border border-stone/60 text-[13px] space-y-2">
                <div className="flex items-center justify-between">
                  <p className="font-medium text-stone-dark text-[11px] uppercase tracking-wider">
                    Reason: {req.reasonCode}
                  </p>
                  <p className="text-xs text-stone-dark">
                    {req.items.reduce((s, it) => s + it.qty, 0)} item(s) requested
                  </p>
                </div>
                {req.customerNote && (
                  <p className="text-ink text-xs">
                    <strong>Customer Note:</strong> {req.customerNote}
                  </p>
                )}
                {req.adminNote && (
                  <p className="text-xs text-stone-dark border-t border-stone/30 pt-1">
                    <strong>Admin Note:</strong> {req.adminNote}
                  </p>
                )}
              </div>

              {/* Quick Actions if REQUESTED */}
              {req.status === "REQUESTED" && (
                <div className="flex flex-wrap items-center gap-3 pt-1">
                  <form
                    action={async (formData: FormData) => {
                      "use server";
                      const note = formData.get("note") as string;
                      await approveReturn(req.id, note);
                    }}
                    className="flex gap-2 items-center"
                  >
                    <input
                      name="note"
                      type="text"
                      placeholder="Approval note (optional)"
                      className="px-3 py-1.5 border border-stone text-xs rounded-sm w-44"
                    />
                    <button
                      type="submit"
                      className="px-3.5 py-1.5 bg-emerald-800 text-white text-xs font-medium rounded-sm hover:bg-emerald-900"
                    >
                      APPROVE
                    </button>
                  </form>

                  <form
                    action={async (formData: FormData) => {
                      "use server";
                      const note = formData.get("note") as string;
                      await rejectReturn(req.id, note);
                    }}
                    className="flex gap-2 items-center"
                  >
                    <input
                      name="note"
                      type="text"
                      required
                      placeholder="Rejection reason (required)"
                      className="px-3 py-1.5 border border-stone text-xs rounded-sm w-44"
                    />
                    <button
                      type="submit"
                      className="px-3.5 py-1.5 bg-clay text-white text-xs font-medium rounded-sm hover:bg-red-800"
                    >
                      REJECT
                    </button>
                  </form>
                </div>
              )}
            </div>
          );
        })}

        {returnRequests.length === 0 && (
          <p className="p-8 text-sm text-stone-dark text-center">No return requests found.</p>
        )}
      </div>
    </main>
  );
}
