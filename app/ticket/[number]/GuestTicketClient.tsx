"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { guestReply } from "@/lib/actions/guest-tickets";
import type { TicketStatus } from "@prisma/client";

interface MessageItem {
  id: string;
  author: string;
  body: string;
  createdAt: Date | string;
}

interface Props {
  ticketNumber: string;
  token: string;
  status: TicketStatus;
  messages: MessageItem[];
}

export default function GuestTicketClient({
  ticketNumber,
  token,
  status,
  messages,
}: Props) {
  const router = useRouter();
  const [replyBody, setReplyBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleReply = (e: React.FormEvent) => {
    e.preventDefault();
    if (!replyBody.trim()) return;
    setError(null);

    startTransition(async () => {
      try {
        await guestReply(ticketNumber, token, replyBody);
        setReplyBody("");
        router.refresh();
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to post reply");
      }
    });
  };

  const isClosed = status === "CLOSED";

  return (
    <div className="space-y-6">
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs">
          {error}
        </div>
      )}

      {/* Messages Thread */}
      <div className="bg-white border border-stone p-5 sm:p-6 space-y-4">
        <h2 className="text-sm font-semibold text-ink border-b border-stone/50 pb-2">
          Messages ({messages.length})
        </h2>

        <div className="space-y-4">
          {messages.map((m) => {
            const isStaff = m.author !== "You";
            return (
              <div
                key={m.id}
                className={`p-4 border rounded-xs text-xs space-y-1.5 ${
                  isStaff
                    ? "bg-slate-50 border-slate-200 ml-4 sm:ml-8"
                    : "bg-paper/40 border-stone mr-4 sm:mr-8"
                }`}
              >
                <div className="flex items-center justify-between text-stone-dark">
                  <span className="font-semibold text-ink">
                    {isStaff ? "Customer Support Team" : "You (Customer)"}
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

      {/* Reply Section */}
      {!isClosed ? (
        <div className="bg-white border border-stone p-5 sm:p-6 space-y-3">
          <h3 className="text-xs font-semibold text-ink uppercase tracking-wider">
            Send a Follow-up Message
          </h3>
          <form onSubmit={handleReply} className="space-y-3">
            <textarea
              rows={4}
              required
              value={replyBody}
              onChange={(e) => setReplyBody(e.target.value)}
              placeholder="Provide more information or respond to our support staff..."
              className="w-full p-3 border border-stone text-xs focus:outline-none focus:border-ink bg-paper"
            />
            <div className="flex justify-between items-center">
              <span className="text-[11px] text-stone-dark">
                {status === "RESOLVED"
                  ? "Replying will automatically reopen this ticket for further review."
                  : "Our team will receive your reply immediately."}
              </span>
              <button
                type="submit"
                disabled={isPending || !replyBody.trim()}
                className="px-5 py-2.5 bg-ink text-paper text-xs font-medium uppercase tracking-[0.04em] hover:bg-opacity-90 disabled:opacity-50"
              >
                {isPending ? "SENDING..." : "SEND REPLY"}
              </button>
            </div>
          </form>
        </div>
      ) : (
        <div className="p-4 bg-stone/10 border border-stone text-center text-xs text-stone-dark">
          This ticket has been permanently CLOSED. If you require further assistance, please submit a new ticket.
        </div>
      )}
    </div>
  );
}
