import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/guards";
import { prisma } from "@/lib/prisma";
import AdminTicketClient from "./AdminTicketClient";

export const dynamic = "force-dynamic";

export default async function AdminTicketDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireStaff();
  const { id } = await params;

  const ticket = await prisma.ticket.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, name: true, email: true, phone: true } },
      assignedTo: { select: { id: true, name: true, email: true } },
      order: {
        select: {
          id: true,
          displayId: true,
          total: true,
          paymentStatus: true,
          fulfilmentStatus: true,
        },
      },
      messages: {
        orderBy: { createdAt: "asc" },
        include: {
          authorUser: {
            select: { name: true, email: true, role: true },
          },
        },
      },
    },
  });

  if (!ticket) {
    notFound();
  }

  const staffList = await prisma.user.findMany({
    where: {
      role: { in: ["STAFF", "OWNER"] },
    },
    select: {
      id: true,
      name: true,
      email: true,
    },
    orderBy: { name: "asc" },
  });

  const now = new Date();
  const ackOverdue = !ticket.acknowledgedAt && ticket.ackDueAt <= now;
  const resolveOverdue =
    !["RESOLVED", "CLOSED"].includes(ticket.status) && ticket.resolveDueAt <= now;

  return (
    <main className="max-w-5xl mx-auto px-7 py-8 space-y-6">
      {/* Breadcrumb Navigation */}
      <div className="flex items-center gap-2 text-xs text-stone-dark">
        <Link href="/admin" className="hover:underline">
          Dashboard
        </Link>
        <span>/</span>
        <Link href="/admin/tickets" className="hover:underline">
          Tickets
        </Link>
        <span>/</span>
        <span className="text-ink font-medium">#{ticket.number}</span>
      </div>

      {/* Ticket Header */}
      <div className="bg-white border border-stone p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-medium text-ink">Ticket #{ticket.number}</h1>
              <span
                className={`px-2.5 py-0.5 text-xs font-semibold rounded-xs ${
                  ticket.status === "OPEN"
                    ? "bg-amber-100 text-amber-800"
                    : ticket.status === "IN_PROGRESS"
                    ? "bg-blue-100 text-blue-800"
                    : ticket.status === "WAITING_CUSTOMER"
                    ? "bg-purple-100 text-purple-800"
                    : ticket.status === "RESOLVED"
                    ? "bg-green-100 text-green-800"
                    : "bg-stone/20 text-stone-dark"
                }`}
              >
                {ticket.status}
              </span>
              <span className="text-xs px-2 py-0.5 bg-stone/20 text-stone-dark rounded-xs">
                {ticket.category}
              </span>
            </div>
            <h2 className="text-sm font-semibold text-ink mt-2">{ticket.subject}</h2>
          </div>
          <div className="text-xs text-stone-dark text-right">
            <div>Created: {new Date(ticket.createdAt).toLocaleString()}</div>
            {ticket.source === "GUEST_FORM" && (
              <span className="inline-block mt-1 px-2 py-0.5 bg-stone/20 text-stone-dark rounded-xs text-[11px]">
                Guest Ticket
              </span>
            )}
          </div>
        </div>

        {/* Customer & SLA Info Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4 border-t border-stone/50 text-xs">
          <div>
            <span className="text-stone-dark block font-medium">Customer Details</span>
            <span className="text-ink font-medium block">
              {ticket.user?.name || ticket.guestName || "Guest Customer"}
            </span>
            <span className="text-stone-dark block">
              {ticket.guestEmail || ticket.user?.email || "No email"}
            </span>
            {ticket.user?.phone && (
              <span className="text-stone-dark block">{ticket.user.phone}</span>
            )}
            {ticket.order && (
              <div className="mt-1">
                <Link
                  href={`/admin/orders/${ticket.order.id}`}
                  className="text-ink underline hover:opacity-80"
                >
                  Order #{ticket.order.displayId}
                </Link>
              </div>
            )}
          </div>

          <div>
            <span className="text-stone-dark block font-medium">48h Ack SLA</span>
            {ticket.acknowledgedAt ? (
              <span className="text-emerald-700 font-semibold block">
                Acknowledged on {new Date(ticket.acknowledgedAt).toLocaleString()}
              </span>
            ) : ackOverdue ? (
              <span className="text-red-700 font-semibold block">
                OVERDUE (Due: {new Date(ticket.ackDueAt).toLocaleString()})
              </span>
            ) : (
              <span className="text-stone-dark block">
                Due: {new Date(ticket.ackDueAt).toLocaleString()}
              </span>
            )}
          </div>

          <div>
            <span className="text-stone-dark block font-medium">30-Day Resolution SLA</span>
            {ticket.resolvedAt ? (
              <span className="text-emerald-700 font-semibold block">
                Resolved on {new Date(ticket.resolvedAt).toLocaleString()}
              </span>
            ) : resolveOverdue ? (
              <span className="text-red-700 font-semibold block">
                OVERDUE (Due: {new Date(ticket.resolveDueAt).toLocaleString()})
              </span>
            ) : (
              <span className="text-stone-dark block">
                Due: {new Date(ticket.resolveDueAt).toLocaleString()}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Interactive Client Component */}
      <AdminTicketClient
        ticket={{
          ...ticket,
          customerEmail: ticket.guestEmail || ticket.user?.email || "No email",
          customerPhone: ticket.user?.phone || null,
        }}
        staffList={staffList}
      />
    </main>
  );
}
