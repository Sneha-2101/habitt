import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireStaff } from "@/lib/guards";
import type { Prisma, TicketStatus, TicketCategory } from "@prisma/client";

export const dynamic = "force-dynamic";

export default async function AdminTicketsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; category?: string; overdue?: string }>;
}) {
  await requireStaff();
  const resolvedParams = await searchParams;

  const where: Prisma.TicketWhereInput = {};
  if (resolvedParams.status) {
    where.status = resolvedParams.status as TicketStatus;
  }
  if (resolvedParams.category) {
    where.category = resolvedParams.category as TicketCategory;
  }
  const now = new Date();
  if (resolvedParams.overdue === "ack") {
    where.acknowledgedAt = null;
    where.status = { in: ["OPEN", "IN_PROGRESS", "WAITING_CUSTOMER"] };
    where.ackDueAt = { lte: now };
  } else if (resolvedParams.overdue === "resolve") {
    where.status = { in: ["OPEN", "IN_PROGRESS", "WAITING_CUSTOMER"] };
    where.resolveDueAt = { lte: now };
  }

  const tickets = await prisma.ticket.findMany({
    where,
    include: {
      user: { select: { name: true, email: true } },
      assignedTo: { select: { name: true, email: true } },
      order: { select: { displayId: true } },
      _count: { select: { messages: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const statuses: TicketStatus[] = [
    "OPEN",
    "IN_PROGRESS",
    "WAITING_CUSTOMER",
    "RESOLVED",
    "CLOSED",
  ];

  return (
    <main className="max-w-6xl mx-auto px-7 py-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-medium text-ink">Support & Grievance Tickets</h1>
          <p className="text-xs text-stone-dark mt-0.5">
            Customer inquiries, return issues, and statutory grievances with SLA tracking.
          </p>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center gap-3 bg-white p-3 border border-stone text-xs">
        <span className="font-semibold text-ink">Filters:</span>
        <Link
          href="/admin/tickets"
          className={`px-2.5 py-1 rounded-xs transition-colors ${
            !resolvedParams.status && !resolvedParams.overdue && !resolvedParams.category
              ? "bg-ink text-paper font-medium"
              : "bg-paper text-stone-dark hover:text-ink"
          }`}
        >
          All
        </Link>
        {statuses.map((s) => (
          <Link
            key={s}
            href={`/admin/tickets?status=${s}`}
            className={`px-2.5 py-1 rounded-xs transition-colors ${
              resolvedParams.status === s
                ? "bg-ink text-paper font-medium"
                : "bg-paper text-stone-dark hover:text-ink"
            }`}
          >
            {s}
          </Link>
        ))}
        <span className="text-stone">|</span>
        <Link
          href="/admin/tickets?overdue=ack"
          className={`px-2.5 py-1 rounded-xs transition-colors ${
            resolvedParams.overdue === "ack"
              ? "bg-red-700 text-white font-medium"
              : "bg-red-50 text-red-700 hover:bg-red-100"
          }`}
        >
          Ack Overdue
        </Link>
        <Link
          href="/admin/tickets?overdue=resolve"
          className={`px-2.5 py-1 rounded-xs transition-colors ${
            resolvedParams.overdue === "resolve"
              ? "bg-red-700 text-white font-medium"
              : "bg-red-50 text-red-700 hover:bg-red-100"
          }`}
        >
          Resolution Overdue
        </Link>
      </div>

      {/* Tickets Table */}
      <div className="bg-white border border-stone overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-stone bg-paper/50 text-stone-dark">
              <th className="py-2.5 px-4 font-medium">Ticket #</th>
              <th className="py-2.5 px-4 font-medium">Subject</th>
              <th className="py-2.5 px-4 font-medium">Category</th>
              <th className="py-2.5 px-4 font-medium">Customer</th>
              <th className="py-2.5 px-4 font-medium">Status</th>
              <th className="py-2.5 px-4 font-medium">Assigned</th>
              <th className="py-2.5 px-4 font-medium">Ack SLA</th>
              <th className="py-2.5 px-4 font-medium">Resolution SLA</th>
              <th className="py-2.5 px-4 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone/40">
            {tickets.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-8 text-center text-stone-dark">
                  No tickets found matching the selected filters.
                </td>
              </tr>
            ) : (
              tickets.map((t) => {
                const ackBreach = !t.acknowledgedAt && t.ackDueAt <= now;
                const resolveBreach =
                  !["RESOLVED", "CLOSED"].includes(t.status) && t.resolveDueAt <= now;

                return (
                  <tr key={t.id} className="hover:bg-paper/30 transition-colors">
                    <td className="py-3 px-4 font-mono font-medium text-ink">
                      #{t.number}
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-medium text-ink max-w-xs truncate">{t.subject}</div>
                      {t.order && (
                        <div className="text-[11px] text-stone-dark">
                          Order: {t.order.displayId}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4 text-stone-dark">{t.category}</td>
                    <td className="py-3 px-4">
                      <div className="text-ink">{t.user?.name || t.guestEmail || "Customer"}</div>
                      {t.source === "GUEST_FORM" && (
                        <span className="text-[10px] bg-stone/20 px-1 py-0.5 rounded-xs">
                          Guest
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`px-2 py-0.5 text-[11px] font-medium rounded-xs ${
                          t.status === "OPEN"
                            ? "bg-amber-100 text-amber-800"
                            : t.status === "IN_PROGRESS"
                            ? "bg-blue-100 text-blue-800"
                            : t.status === "WAITING_CUSTOMER"
                            ? "bg-purple-100 text-purple-800"
                            : t.status === "RESOLVED"
                            ? "bg-green-100 text-green-800"
                            : "bg-stone/20 text-stone-dark"
                        }`}
                      >
                        {t.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-stone-dark">
                      {t.assignedTo?.name || "Unassigned"}
                    </td>
                    <td className="py-3 px-4">
                      {t.acknowledgedAt ? (
                        <span className="text-emerald-700 font-medium">Acknowledged</span>
                      ) : ackBreach ? (
                        <span className="text-red-700 font-semibold">Overdue</span>
                      ) : (
                        <span className="text-stone-dark">
                          Due {new Date(t.ackDueAt).toLocaleDateString()}
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      {t.resolvedAt ? (
                        <span className="text-emerald-700 font-medium">Resolved</span>
                      ) : resolveBreach ? (
                        <span className="text-red-700 font-semibold">Overdue</span>
                      ) : (
                        <span className="text-stone-dark">
                          Due {new Date(t.resolveDueAt).toLocaleDateString()}
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <Link
                        href={`/admin/tickets/${t.id}`}
                        className="text-ink hover:underline font-medium"
                      >
                        View &rarr;
                      </Link>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
