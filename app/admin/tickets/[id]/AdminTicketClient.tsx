"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  assignTicket,
  setTicketStatus,
  staffReply,
  addInternalNote,
} from "@/lib/actions/admin-tickets";
import type { TicketStatus } from "@prisma/client";

interface MessageItem {
  id: string;
  authorType: "CUSTOMER" | "STAFF" | "SYSTEM";
  body: string;
  internal: boolean;
  createdAt: Date | string;
  authorUser?: {
    name: string | null;
    email: string | null;
    role: string;
  } | null;
}

interface StaffUser {
  id: string;
  name: string | null;
  email: string | null;
}

interface Props {
  ticket: {
    id: string;
    number: string;
    status: TicketStatus;
    category: string;
    subject: string;
    customerEmail: string;
    customerPhone: string | null;
    assignedToId: string | null;
    ackDueAt: Date | string;
    resolveDueAt: Date | string;
    acknowledgedAt: Date | string | null;
    resolvedAt: Date | string | null;
    closedAt: Date | string | null;
    messages: MessageItem[];
  };
  staffList: StaffUser[];
}

export default function AdminTicketClient({ ticket, staffList }: Props) {
  const router = useRouter();
  const [status, setStatus] = useState<TicketStatus>(ticket.status);
  const [assignedToId, setAssignedToId] = useState<string>(ticket.assignedToId || "");
  const [replyBody, setReplyBody] = useState("");
  const [noteBody, setNoteBody] = useState("");
  const [activeTab, setActiveTab] = useState<"reply" | "note">("reply");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleStatusChange = (newStatus: TicketStatus) => {
    setError(null);
    startTransition(async () => {
      try {
        await setTicketStatus(ticket.id, newStatus);
        setStatus(newStatus);
        router.refresh();
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to update status");
      }
    });
  };

  const handleAssignChange = (newAssignee: string) => {
    setError(null);
    startTransition(async () => {
      try {
        await assignTicket(ticket.id, newAssignee || null);
        setAssignedToId(newAssignee);
        router.refresh();
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to assign ticket");
      }
    });
  };

  const handleSendReply = (e: React.FormEvent) => {
    e.preventDefault();
    if (!replyBody.trim()) return;
    setError(null);

    startTransition(async () => {
      try {
        await staffReply(ticket.id, replyBody);
        setReplyBody("");
        router.refresh();
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to post reply");
      }
    });
  };

  const handleAddNote = (e: React.FormEvent) => {
    e.preventDefault();
    if (!noteBody.trim()) return;
    setError(null);

    startTransition(async () => {
      try {
        await addInternalNote(ticket.id, noteBody);
        setNoteBody("");
        router.refresh();
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to add internal note");
      }
    });
  };

  return (
    <div className="space-y-6">
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs">
          {error}
        </div>
      )}

      {/* Quick Controls Card */}
      <div className="bg-white border border-stone p-4 flex flex-wrap items-center justify-between gap-4 text-xs">
        <div className="flex items-center gap-3">
          <label className="font-semibold text-ink">Status:</label>
          <select
            value={status}
            disabled={isPending || status === "CLOSED"}
            onChange={(e) => handleStatusChange(e.target.value as TicketStatus)}
            className="border border-stone px-2.5 py-1.5 bg-paper rounded-xs text-xs focus:outline-none focus:border-ink"
          >
            <option value="OPEN">OPEN</option>
            <option value="IN_PROGRESS">IN_PROGRESS</option>
            <option value="WAITING_CUSTOMER">WAITING_CUSTOMER</option>
            <option value="RESOLVED">RESOLVED</option>
            <option value="CLOSED">CLOSED</option>
          </select>
        </div>

        <div className="flex items-center gap-3">
          <label className="font-semibold text-ink">Assigned Staff:</label>
          <select
            value={assignedToId}
            disabled={isPending}
            onChange={(e) => handleAssignChange(e.target.value)}
            className="border border-stone px-2.5 py-1.5 bg-paper rounded-xs text-xs focus:outline-none focus:border-ink"
          >
            <option value="">Unassigned</option>
            {staffList.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name || s.email}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Thread Messages */}
      <div className="bg-white border border-stone p-5 space-y-4">
        <h2 className="text-sm font-semibold text-ink border-b border-stone/50 pb-2">
          Conversation Thread ({ticket.messages.length} messages)
        </h2>

        <div className="space-y-4">
          {ticket.messages.map((m) => {
            if (m.internal) {
              return (
                <div
                  key={m.id}
                  className="bg-amber-50/70 border border-amber-300/80 p-3.5 rounded-xs text-xs space-y-1.5"
                >
                  <div className="flex items-center justify-between font-medium text-amber-900">
                    <span className="flex items-center gap-1.5 font-semibold">
                      🔒 INTERNAL NOTE (Only staff can see this)
                    </span>
                    <span className="text-[11px] text-amber-700">
                      {m.authorUser?.name || m.authorUser?.email || "Staff"} &bull;{" "}
                      {new Date(m.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <p className="text-amber-950 whitespace-pre-wrap leading-relaxed">{m.body}</p>
                </div>
              );
            }

            const isStaff = m.authorType === "STAFF";
            return (
              <div
                key={m.id}
                className={`p-4 border rounded-xs text-xs space-y-1.5 ${
                  isStaff
                    ? "bg-slate-50 border-slate-200 ml-6"
                    : "bg-paper/40 border-stone mr-6"
                }`}
              >
                <div className="flex items-center justify-between text-stone-dark">
                  <span className="font-semibold text-ink">
                    {isStaff
                      ? `Staff Support (${m.authorUser?.name || "Support Agent"})`
                      : `Customer (${ticket.customerEmail})`}
                  </span>
                  <span className="text-[11px] font-mono">
                    {new Date(m.createdAt).toLocaleString()}
                  </span>
                </div>
                <p className="text-ink whitespace-pre-wrap leading-relaxed">{m.body}</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Reply / Internal Note Composer */}
      {status !== "CLOSED" ? (
        <div className="bg-white border border-stone p-5 space-y-3">
          <div className="flex items-center gap-2 border-b border-stone/50 pb-2">
            <button
              type="button"
              onClick={() => setActiveTab("reply")}
              className={`px-3 py-1.5 text-xs font-medium rounded-xs transition-colors ${
                activeTab === "reply"
                  ? "bg-ink text-paper"
                  : "bg-paper text-stone-dark hover:text-ink"
              }`}
            >
              Reply to Customer
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("note")}
              className={`px-3 py-1.5 text-xs font-medium rounded-xs transition-colors ${
                activeTab === "note"
                  ? "bg-amber-100 text-amber-900 font-semibold"
                  : "bg-paper text-stone-dark hover:text-ink"
              }`}
            >
              🔒 Add Internal Note
            </button>
          </div>

          {activeTab === "reply" ? (
            <form onSubmit={handleSendReply} className="space-y-3">
              <textarea
                rows={4}
                required
                value={replyBody}
                onChange={(e) => setReplyBody(e.target.value)}
                placeholder="Type your official response to the customer..."
                className="w-full p-3 border border-stone text-xs focus:outline-none focus:border-ink"
              />
              <div className="flex justify-between items-center">
                <span className="text-[11px] text-stone-dark">
                  Customer will receive an email update with this response.
                </span>
                <button
                  type="submit"
                  disabled={isPending || !replyBody.trim()}
                  className="px-4 py-2 bg-ink text-paper text-xs font-medium tracking-[0.04em] hover:bg-opacity-90 disabled:opacity-50"
                >
                  {isPending ? "SENDING..." : "SEND REPLY"}
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={handleAddNote} className="space-y-3">
              <textarea
                rows={4}
                required
                value={noteBody}
                onChange={(e) => setNoteBody(e.target.value)}
                placeholder="Write an internal note for staff members only (not visible to customer)..."
                className="w-full p-3 border border-amber-300 bg-amber-50/30 text-xs focus:outline-none focus:border-amber-600"
              />
              <div className="flex justify-between items-center">
                <span className="text-[11px] text-amber-800">
                  Visible ONLY to staff members. Will never be shown to customer.
                </span>
                <button
                  type="submit"
                  disabled={isPending || !noteBody.trim()}
                  className="px-4 py-2 bg-amber-800 text-white text-xs font-medium hover:bg-amber-900 disabled:opacity-50"
                >
                  {isPending ? "SAVING..." : "SAVE INTERNAL NOTE"}
                </button>
              </div>
            </form>
          )}
        </div>
      ) : (
        <div className="p-4 bg-stone/10 border border-stone text-center text-xs text-stone-dark">
          This ticket is CLOSED. No further replies or internal notes can be posted.
        </div>
      )}
    </div>
  );
}
