"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { subscribeNewsletter } from "@/lib/actions/newsletter";

export default function Footer() {
  const [email, setEmail] = useState("");
  const [statusMsg, setStatusMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubscribe(e: React.FormEvent) {
    e.preventDefault();
    setStatusMsg(null);

    startTransition(async () => {
      try {
        const res = await subscribeNewsletter(email);
        setStatusMsg({
          type: "success",
          text: `Welcome! Use code "${res.code}" for 10% off your first purchase.`,
        });
        setEmail("");
      } catch (err) {
        setStatusMsg({
          type: "error",
          text: err instanceof Error ? err.message : "Failed to subscribe.",
        });
      }
    });
  }

  return (
    <footer className="mt-20 border-t border-stone bg-paper text-ink">
      <div className="max-w-6xl mx-auto px-4 sm:px-7 py-12 grid grid-cols-1 md:grid-cols-3 gap-8">
        {/* Column 1: Brand & Tagline */}
        <div className="space-y-3">
          <h4 className="font-display font-medium text-lg tracking-[0.02em]">habitt</h4>
          <p className="text-xs text-stone-dark leading-relaxed max-w-xs">
            Considered minimalist basics — heavier fabrics, honest fits, made to wear in over years.
          </p>
          <p className="text-[11px] text-stone-dark font-mono pt-2">
            © {new Date().getFullYear()} Habitt Apparel. All rights reserved.
          </p>
        </div>

        {/* Column 2: Support & Trust Links (Footer-only nav per design restraint rules) */}
        <div className="space-y-3">
          <h4 className="text-xs font-semibold text-stone-dark uppercase tracking-wider">Support & Info</h4>
          <ul className="space-y-2 text-xs">
            <li>
              <Link href="/support" className="hover:underline text-ink">
                Customer Support & FAQ
              </Link>
            </li>
            <li>
              <Link href="/policies/returns" className="hover:underline text-ink">
                Returns & Refund Policy
              </Link>
            </li>
            <li>
              <Link href="/policies/shipping" className="hover:underline text-ink">
                Shipping & Delivery Guidelines
              </Link>
            </li>
            <li>
              <Link href="/policies/terms" className="hover:underline text-ink">
                Terms of Service
              </Link>
            </li>
            <li>
              <Link href="/policies/privacy" className="hover:underline text-ink">
                Privacy Policy
              </Link>
            </li>
          </ul>
        </div>

        {/* Column 3: Newsletter Signup */}
        <div className="space-y-3">
          <h4 className="text-xs font-semibold text-stone-dark uppercase tracking-wider">Join The Newsletter</h4>
          <p className="text-xs text-stone-dark">
            Subscribe for quiet collection drops & get 10% off your first order.
          </p>
          <form onSubmit={handleSubscribe} className="space-y-2">
            <div className="flex gap-2">
              <input
                type="email"
                required
                placeholder="Enter your email..."
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="flex-1 px-3 py-2 text-xs border border-stone bg-white rounded-sm focus:outline-none focus:border-ink"
              />
              <button
                type="submit"
                disabled={isPending}
                className="px-4 py-2 bg-ink text-paper text-xs font-medium uppercase tracking-[0.04em] rounded-sm hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {isPending ? "..." : "JOIN"}
              </button>
            </div>
            {statusMsg && (
              <p className={`text-xs font-medium ${statusMsg.type === "success" ? "text-moss" : "text-clay"}`}>
                {statusMsg.text}
              </p>
            )}
          </form>
        </div>
      </div>
    </footer>
  );
}
