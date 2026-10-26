import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatINR } from "@/lib/money";
import { approveReturn, rejectReturn } from "@/lib/actions/returns";
import type { ReturnStatus } from "@prisma/client";

export default async function AdminReturnsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const resolvedParams = await searchParams;
  const statusFilter = resolvedParams.status as ReturnStatus | undefined;

  const returnRequests = await prisma.returnRequest.findMany({
    where: statusFilter ? { status: statusFilter } : {},
    include: {
      order: { select: { id: true, displayId: true, total: true, status: true } },
      user: { select: { name: true, email: true, phone: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const statuses: ReturnStatus[] = ["REQUESTED", "APPROVED", "REFUNDED", "REJECTED"];

  return (
    <main className="px-7 py-9 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-medium">Return Requests Queue</h1>
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
        {returnRequests.map((req) => (
          <div key={req.id} className="p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[13px]">
              <div>
                <div className="flex items-center gap-3">
                  <Link href={`/admin/orders/${req.order.id}`} className="font-mono font-medium text-ink hover:underline">
                    Order #{req.order.displayId}
                  </Link>
                  <span className="font-mono text-stone-dark">{formatINR(req.order.total)}</span>
                  <span
                    className={`text-xs font-semibold px-2 py-0.5 rounded ${
                      req.status === "REFUNDED" || req.status === "APPROVED"
                        ? "bg-emerald-100 text-emerald-800"
                        : req.status === "REJECTED"
                        ? "bg-red-100 text-red-800"
                        : "bg-amber-100 text-amber-800"
                    }`}
                  >
                    {req.status}
                  </span>
                </div>
                <p className="text-xs text-stone-dark mt-1">
                  Customer: {req.user.name} ({req.user.email}) · {new Date(req.createdAt).toLocaleString("en-IN")}
                </p>
              </div>
            </div>

            <div className="p-3 bg-paper border border-stone/60 text-[13px]">
              <p className="font-medium text-stone-dark text-[11px] uppercase tracking-wider mb-0.5">Reason</p>
              <p className="text-ink">{req.reason}</p>
              {req.adminNote && (
                <p className="text-xs text-stone-dark pt-1 border-t border-stone/30 mt-2">
                  <strong>Admin Note:</strong> {req.adminNote}
                </p>
              )}
            </div>

            {/* Action Form if REQUESTED */}
            {req.status === "REQUESTED" && (
              <div className="flex flex-wrap items-center gap-3 pt-2">
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
                    className="px-3 py-1.5 border border-stone text-xs rounded-sm w-48"
                  />
                  <button type="submit" className="px-4 py-1.5 bg-emerald-800 text-white text-xs font-medium rounded-sm">
                    APPROVE & REFUND
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
                    className="px-3 py-1.5 border border-stone text-xs rounded-sm w-48"
                  />
                  <button type="submit" className="px-4 py-1.5 bg-clay text-white text-xs font-medium rounded-sm">
                    REJECT
                  </button>
                </form>
              </div>
            )}
          </div>
        ))}

        {returnRequests.length === 0 && (
          <p className="p-8 text-sm text-stone-dark text-center">No return requests found.</p>
        )}
      </div>
    </main>
  );
}
