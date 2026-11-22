import { notFound } from "next/navigation";
import Link from "next/link";
import { getGuestTicket } from "@/lib/actions/guest-tickets";
import GuestTicketClient from "./GuestTicketClient";

export const dynamic = "force-dynamic";

export default async function GuestTicketPage({
  params,
  searchParams,
}: {
  params: Promise<{ number: string }>;
  searchParams: Promise<{ t?: string }>;
}) {
  const { number } = await params;
  const { t: token } = await searchParams;

  if (!token) {
    notFound();
  }

  const ticket = await getGuestTicket(number, token);
  if (!ticket) {
    notFound();
  }

  return (
    <main className="max-w-4xl mx-auto px-4 sm:px-7 py-12 space-y-6">
      <div className="flex items-center gap-2 text-xs text-stone-dark">
        <Link href="/" className="hover:underline">
          Home
        </Link>
        <span>/</span>
        <Link href="/contact" className="hover:underline">
          Support
        </Link>
        <span>/</span>
        <span className="text-ink font-medium">#{ticket.ticketNumber}</span>
      </div>

      {/* Ticket Header Card */}
      <div className="bg-white border border-stone p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-medium text-ink">Ticket #{ticket.ticketNumber}</h1>
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
          <div className="text-xs text-stone-dark sm:text-right">
            <div>Submitted: {new Date(ticket.createdAt).toLocaleDateString()}</div>
            {ticket.orderRef && <div>Order: {ticket.orderRef}</div>}
          </div>
        </div>

        {/* Status banner */}
        {ticket.status === "RESOLVED" && (
          <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs">
            This ticket has been marked as resolved. If you still have questions, you may reply below within 14 days to reopen it.
          </div>
        )}
      </div>

      <GuestTicketClient
        ticketNumber={ticket.ticketNumber}
        token={token}
        status={ticket.status}
        messages={ticket.messages}
      />
    </main>
  );
}
