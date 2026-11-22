"use client";

import { useState, useEffect, useTransition } from "react";
import Link from "next/link";
import {
  requestGuestTicketCode,
  createGuestTicket,
} from "@/lib/actions/guest-tickets";
import type { TicketCategory } from "@prisma/client";

export default function ContactClient() {
  const [step, setStep] = useState<"EMAIL" | "DETAILS" | "SUCCESS">("EMAIL");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [category, setCategory] = useState<TicketCategory>("ORDER");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [orderDisplayId, setOrderDisplayId] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [successData, setSuccessData] = useState<{
    ticketNumber: string;
    token: string;
  } | null>(null);
  const [isPending, startTransition] = useTransition();

  const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

  useEffect(() => {
    if (turnstileSiteKey && typeof window !== "undefined") {
      (window as unknown as { onContactTurnstileSuccess?: (token: string) => void }).onContactTurnstileSuccess = (token: string) => {
        setTurnstileToken(token);
      };
    }
  }, [turnstileSiteKey]);

  const handleRequestOtp = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    startTransition(async () => {
      try {
        const res = await requestGuestTicketCode(email, turnstileToken || undefined);
        if (!res.success) {
          setError(res.message || "Failed to send code");
          return;
        }
        setStep("DETAILS");
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Request failed");
      }
    });
  };

  const handleCreateTicket = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    startTransition(async () => {
      try {
        const res = await createGuestTicket({
          email,
          code,
          category,
          subject,
          body,
          orderRef: orderDisplayId.trim() || undefined,
        });

        if (!res.success || !res.ticketNumber || !res.token) {
          setError(res.message || "Failed to submit ticket");
          return;
        }

        setSuccessData({
          ticketNumber: res.ticketNumber,
          token: res.token,
        });
        setStep("SUCCESS");
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to create ticket");
      }
    });
  };

  return (
    <div className="bg-white border border-stone p-6 sm:p-8 space-y-6">
      <div className="border-b border-stone/50 pb-3">
        <h2 className="text-base font-semibold text-ink">Submit a Support or Grievance Ticket</h2>
        <p className="text-xs text-stone-dark mt-1">
          Guest customer portal. We verify your email before ticket submission to safeguard communications.
        </p>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs">
          {error}
        </div>
      )}

      {step === "EMAIL" && (
        <form onSubmit={handleRequestOtp} className="space-y-4">
          <div>
            <label htmlFor="guestEmail" className="block text-xs font-medium text-ink mb-1">
              Your Email Address
            </label>
            <input
              type="email"
              id="guestEmail"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="e.g. customer@example.com"
              className="w-full px-3 py-2 border border-stone text-xs focus:outline-none focus:border-ink bg-paper"
            />
            <p className="text-[11px] text-stone-dark mt-1">
              A 6-digit one-time code will be dispatched to verify email ownership.
            </p>
          </div>

          {turnstileSiteKey && (
            <div
              className="cf-turnstile my-2"
              data-sitekey={turnstileSiteKey}
              data-callback="onContactTurnstileSuccess"
              data-theme="light"
            />
          )}

          <button
            type="submit"
            disabled={isPending || !email.trim()}
            className="px-5 py-2.5 bg-ink text-paper text-xs font-medium uppercase tracking-[0.04em] hover:bg-opacity-90 disabled:opacity-50"
          >
            {isPending ? "SENDING CODE..." : "CONTINUE WITH EMAIL"}
          </button>
        </form>
      )}

      {step === "DETAILS" && (
        <form onSubmit={handleCreateTicket} className="space-y-4">
          <div className="p-3 bg-paper border border-stone text-xs text-ink flex items-center justify-between">
            <span>
              Verifying email: <strong>{email}</strong>
            </span>
            <button
              type="button"
              onClick={() => {
                setStep("EMAIL");
                setCode("");
                setError(null);
              }}
              className="text-stone-dark hover:text-ink underline text-[11px]"
            >
              Change
            </button>
          </div>

          <div>
            <label htmlFor="otpCode" className="block text-xs font-medium text-ink mb-1">
              6-Digit Verification Code
            </label>
            <input
              type="text"
              id="otpCode"
              required
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              placeholder="Enter 6-digit code"
              className="w-full px-3 py-2 border border-stone text-xs font-mono tracking-widest focus:outline-none focus:border-ink bg-paper"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="ticketCategory" className="block text-xs font-medium text-ink mb-1">
                Category
              </label>
              <select
                id="ticketCategory"
                value={category}
                onChange={(e) => setCategory(e.target.value as TicketCategory)}
                className="w-full px-3 py-2 border border-stone text-xs focus:outline-none focus:border-ink bg-paper"
              >
                <option value="ORDER">Order Status & Tracking</option>
                <option value="RETURN_REFUND">Returns & Exchanges</option>
                <option value="PAYMENT">Payment & Refund Inquiries</option>
                <option value="PRODUCT">Product Sizing & Quality</option>
                <option value="ACCOUNT">Account Inquiries</option>
                <option value="GRIEVANCE">Grievance Redressal (Statutory)</option>
                <option value="OTHER">Other Questions</option>
              </select>
            </div>

            <div>
              <label htmlFor="ticketOrder" className="block text-xs font-medium text-ink mb-1">
                Order ID (Optional)
              </label>
              <input
                type="text"
                id="ticketOrder"
                value={orderDisplayId}
                onChange={(e) => setOrderDisplayId(e.target.value)}
                placeholder="e.g. HB-1002"
                className="w-full px-3 py-2 border border-stone text-xs uppercase focus:outline-none focus:border-ink bg-paper"
              />
            </div>
          </div>

          <div>
            <label htmlFor="ticketSubject" className="block text-xs font-medium text-ink mb-1">
              Subject
            </label>
            <input
              type="text"
              id="ticketSubject"
              required
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Brief summary of your query"
              className="w-full px-3 py-2 border border-stone text-xs focus:outline-none focus:border-ink bg-paper"
            />
          </div>

          <div>
            <label htmlFor="ticketBody" className="block text-xs font-medium text-ink mb-1">
              Detailed Description
            </label>
            <textarea
              id="ticketBody"
              required
              rows={4}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Provide relevant details so our team can investigate and resolve quickly..."
              className="w-full px-3 py-2 border border-stone text-xs focus:outline-none focus:border-ink bg-paper"
            />
          </div>

          <button
            type="submit"
            disabled={isPending || code.length !== 6 || !subject.trim() || !body.trim()}
            className="px-5 py-2.5 bg-ink text-paper text-xs font-medium uppercase tracking-[0.04em] hover:bg-opacity-90 disabled:opacity-50"
          >
            {isPending ? "SUBMITTING TICKET..." : "SUBMIT TICKET"}
          </button>
        </form>
      )}

      {step === "SUCCESS" && successData && (
        <div className="space-y-4 py-4 text-center">
          <div className="w-12 h-12 mx-auto bg-emerald-100 text-emerald-800 rounded-full flex items-center justify-center text-xl font-bold">
            ✓
          </div>
          <h3 className="text-base font-semibold text-ink">Ticket Created Successfully</h3>
          <p className="text-xs text-stone-dark max-w-md mx-auto">
            Your ticket <strong>#{successData.ticketNumber}</strong> has been logged. Our team acknowledges tickets within 48 hours. A secure access link has also been sent to your email.
          </p>
          <div className="pt-2">
            <Link
              href={`/ticket/${successData.ticketNumber}?t=${successData.token}`}
              className="inline-block px-5 py-2.5 bg-ink text-paper text-xs font-medium tracking-[0.04em] hover:bg-opacity-90"
            >
              VIEW TICKET & THREAD &rarr;
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
