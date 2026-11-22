"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createTicket, replyToTicket } from "@/lib/actions/tickets";
import type { TicketStatus, TicketCategory } from "@prisma/client";

export interface CustomerTicketMessage {
  id: string;
  author: string;
  body: string;
  createdAt: Date | string;
}

export interface CustomerTicketItem {
  id: string;
  number: string;
  subject: string;
  category: TicketCategory;
  status: TicketStatus;
  orderRef?: string | null;
  ackDueAt: Date | string;
  resolveDueAt: Date | string;
  acknowledgedAt?: Date | string | null;
  resolvedAt?: Date | string | null;
  closedAt?: Date | string | null;
  createdAt: Date | string;
  messages: CustomerTicketMessage[];
}

interface Props {
  initialTickets: CustomerTicketItem[];
  orders: Array<{ id: string; displayId: string }>;
}

export default function AccountSupportTickets({ initialTickets, orders }: Props) {
  const router = useRouter();
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(
    initialTickets.length > 0 ? initialTickets[0].id : null
  );
  const [isModalOpen, setIsModalOpen] = useState(false);

  // New ticket form
  const [category, setCategory] = useState<TicketCategory>("ORDER");
  const [orderId, setOrderId] = useState<string>("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  // Reply form
  const [replyText, setReplyText] = useState("");
  const [replyError, setReplyError] = useState<string | null>(null);

  const [isPending, startTransition] = useTransition();

  const selectedTicket = initialTickets.find((t) => t.id === selectedTicketId) || null;

  const handleCreateTicket = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    startTransition(async () => {
      try {
        const res = await createTicket({
          subject,
          body,
          category,
          orderId: orderId || undefined,
        });

        setIsModalOpen(false);
        setSubject("");
        setBody("");
        setOrderId("");
        setCategory("ORDER");
        setSelectedTicketId(res.ticket.id);
        router.refresh();
      } catch (err: unknown) {
        setFormError(err instanceof Error ? err.message : "Failed to create ticket");
      }
    });
  };

  const handleSendReply = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTicket || !replyText.trim()) return;
    setReplyError(null);

    startTransition(async () => {
      try {
        await replyToTicket(selectedTicket.id, replyText);
        setReplyText("");
        router.refresh();
      } catch (err: unknown) {
        setReplyError(err instanceof Error ? err.message : "Failed to post reply");
      }
    });
  };

  return (
    <section className="border border-stone p-6 bg-white rounded-none space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-stone/50 pb-4">
        <div>
          <h2 className="text-base font-semibold text-ink">Support & Grievance Tickets</h2>
          <p className="text-xs text-stone-dark mt-0.5">
            Direct thread with customer support. Acknowledged within 48 hours.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setIsModalOpen(true);
            setFormError(null);
          }}
          className="px-4 py-2 bg-ink text-paper text-xs font-medium uppercase tracking-[0.04em] hover:bg-opacity-90 transition-opacity"
        >
          + Raise New Ticket
        </button>
      </div>

      {initialTickets.length === 0 ? (
        <div className="py-8 text-center text-xs text-stone-dark space-y-2">
          <p>You have not raised any support or grievance tickets yet.</p>
          <button
            type="button"
            onClick={() => setIsModalOpen(true)}
            className="text-ink underline font-medium"
          >
            Create your first ticket
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Ticket List Sidebar */}
          <div className="space-y-2 border-r border-stone/40 pr-0 md:pr-4">
            <span className="text-[11px] font-semibold text-stone-dark uppercase tracking-wider block mb-2">
              Your Tickets ({initialTickets.length})
            </span>
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {initialTickets.map((t) => {
                const isSelected = t.id === selectedTicketId;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      setSelectedTicketId(t.id);
                      setReplyError(null);
                    }}
                    className={`w-full text-left p-3 border rounded-xs text-xs transition-colors ${
                      isSelected
                        ? "bg-paper border-ink"
                        : "bg-white border-stone/60 hover:bg-paper/40"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-mono font-medium text-ink">#{t.number}</span>
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded-xs font-semibold ${
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
                    </div>
                    <div className="font-medium text-ink truncate">{t.subject}</div>
                    <div className="text-[11px] text-stone-dark flex justify-between mt-1">
                      <span>{t.category}</span>
                      <span>{new Date(t.createdAt).toLocaleDateString()}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Ticket Conversation Detail */}
          <div className="md:col-span-2 space-y-4">
            {selectedTicket ? (
              <div className="space-y-4">
                <div className="bg-paper/40 border border-stone/60 p-4 rounded-xs space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-semibold text-ink">
                        #{selectedTicket.number}
                      </span>
                      <span className="text-[11px] px-2 py-0.5 bg-stone/20 text-stone-dark rounded-xs">
                        {selectedTicket.category}
                      </span>
                    </div>
                    <span className="text-xs text-stone-dark">
                      Opened: {new Date(selectedTicket.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  <h3 className="text-sm font-semibold text-ink">{selectedTicket.subject}</h3>
                  {selectedTicket.orderRef && (
                    <p className="text-xs text-stone-dark">
                      Linked Order: <strong>{selectedTicket.orderRef}</strong>
                    </p>
                  )}
                  {selectedTicket.status === "RESOLVED" && (
                    <div className="p-2.5 bg-emerald-50 border border-emerald-200 text-emerald-800 text-[11px]">
                      This ticket was marked resolved. Replying below within 14 days will automatically reopen it.
                    </div>
                  )}
                  {selectedTicket.status === "CLOSED" && (
                    <div className="p-2.5 bg-stone/10 border border-stone text-stone-dark text-[11px]">
                      This ticket has been permanently closed.
                    </div>
                  )}
                </div>

                {/* Messages Thread */}
                <div className="space-y-3 max-h-80 overflow-y-auto p-1">
                  {selectedTicket.messages.map((m) => {
                    const isUser = m.author === "You";
                    return (
                      <div
                        key={m.id}
                        className={`p-3.5 border rounded-xs text-xs space-y-1 ${
                          isUser
                            ? "bg-white border-stone mr-4"
                            : "bg-slate-50 border-slate-200 ml-4"
                        }`}
                      >
                        <div className="flex justify-between items-center text-stone-dark">
                          <span className="font-semibold text-ink">{m.author}</span>
                          <span className="text-[11px] font-mono">
                            {new Date(m.createdAt).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                              day: "numeric",
                              month: "short",
                            })}
                          </span>
                        </div>
                        <p className="text-ink whitespace-pre-wrap leading-relaxed">{m.body}</p>
                      </div>
                    );
                  })}
                </div>

                {/* Reply Form */}
                {selectedTicket.status !== "CLOSED" && (
                  <form onSubmit={handleSendReply} className="space-y-2 pt-2">
                    {replyError && (
                      <p className="text-xs text-red-700 bg-red-50 p-2 border border-red-200">
                        {replyError}
                      </p>
                    )}
                    <textarea
                      rows={3}
                      required
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      placeholder="Type your reply to customer support..."
                      className="w-full p-3 border border-stone text-xs focus:outline-none focus:border-ink bg-white"
                    />
                    <div className="flex justify-end">
                      <button
                        type="submit"
                        disabled={isPending || !replyText.trim()}
                        className="px-4 py-2 bg-ink text-paper text-xs font-medium uppercase tracking-[0.04em] hover:bg-opacity-90 disabled:opacity-50"
                      >
                        {isPending ? "SENDING..." : "REPLY"}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            ) : (
              <div className="text-xs text-stone-dark py-8 text-center">
                Select a ticket from the left to view conversation.
              </div>
            )}
          </div>
        </div>
      )}

      {/* New Ticket Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white border border-stone p-6 max-w-lg w-full space-y-4">
            <div className="flex items-center justify-between border-b border-stone/50 pb-2">
              <h3 className="text-sm font-semibold text-ink">Raise Support Ticket</h3>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="text-stone-dark hover:text-ink text-sm font-bold"
              >
                &times;
              </button>
            </div>

            {formError && (
              <div className="p-2.5 bg-red-50 border border-red-200 text-red-700 text-xs">
                {formError}
              </div>
            )}

            <form onSubmit={handleCreateTicket} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="createCategory" className="block text-xs font-medium text-ink mb-1">
                    Category
                  </label>
                  <select
                    id="createCategory"
                    value={category}
                    onChange={(e) => setCategory(e.target.value as TicketCategory)}
                    className="w-full px-2.5 py-2 border border-stone text-xs focus:outline-none focus:border-ink bg-paper"
                  >
                    <option value="ORDER">Order Status & Tracking</option>
                    <option value="RETURN_REFUND">Return & Exchange</option>
                    <option value="PAYMENT">Payment & Refund</option>
                    <option value="PRODUCT">Product Quality & Sizing</option>
                    <option value="ACCOUNT">Account Inquiries</option>
                    <option value="GRIEVANCE">Grievance Redressal</option>
                    <option value="OTHER">Other Questions</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="createOrder" className="block text-xs font-medium text-ink mb-1">
                    Related Order
                  </label>
                  <select
                    id="createOrder"
                    value={orderId}
                    onChange={(e) => setOrderId(e.target.value)}
                    className="w-full px-2.5 py-2 border border-stone text-xs focus:outline-none focus:border-ink bg-paper"
                  >
                    <option value="">None / General Inquiry</option>
                    {orders.map((o) => (
                      <option key={o.id} value={o.id}>
                        Order #{o.displayId}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor="createSubject" className="block text-xs font-medium text-ink mb-1">
                  Subject
                </label>
                <input
                  type="text"
                  id="createSubject"
                  required
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Summary of issue"
                  className="w-full px-2.5 py-2 border border-stone text-xs focus:outline-none focus:border-ink bg-paper"
                />
              </div>

              <div>
                <label htmlFor="createBody" className="block text-xs font-medium text-ink mb-1">
                  Message
                </label>
                <textarea
                  id="createBody"
                  required
                  rows={4}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="Describe your inquiry or grievance in detail..."
                  className="w-full px-2.5 py-2 border border-stone text-xs focus:outline-none focus:border-ink bg-paper"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-stone/50">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 border border-stone text-xs text-stone-dark hover:text-ink"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPending || !subject.trim() || !body.trim()}
                  className="px-4 py-2 bg-ink text-paper text-xs font-medium uppercase tracking-[0.04em] hover:bg-opacity-90 disabled:opacity-50"
                >
                  {isPending ? "SUBMITTING..." : "SUBMIT TICKET"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
