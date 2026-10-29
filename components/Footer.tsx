"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { subscribeNewsletter } from "@/lib/actions/newsletter";

interface FooterProps {
  businessName?: string;
  businessTagline?: string;
  legalName?: string | null;
  businessAddress?: string | null;
}

export default function Footer({
  businessName = "habitt",
  businessTagline = "Considered minimalist basics — heavier fabrics, honest fits, made to wear in over years.",
  legalName,
  businessAddress,
}: FooterProps = {}) {
  const [email, setEmail] = useState("");
  const [statusMsg, setStatusMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubscribe(e: React.FormEvent) {
    e.preventDefault();
    setStatusMsg(null);

    startTransition(async () => {
      try {
        await subscribeNewsletter(email);
        setStatusMsg({
          type: "success",
          text: "Thank you for subscribing! Check your email for your welcome discount.",
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

  const displayName = legalName || businessName || "habitt";

  return (
    <footer className="mt-20 border-t border-stone bg-paper text-ink">
      <div className="max-w-6xl mx-auto px-4 sm:px-7 py-12 grid grid-cols-1 md:grid-cols-3 gap-8">
        {/* Column 1: Brand & Tagline */}
        <div className="space-y-3">
          <h4 className="font-display font-medium text-lg tracking-[0.02em]">{businessName}</h4>
          {businessTagline && (
            <p className="text-xs text-stone-dark leading-relaxed max-w-xs">
              {businessTagline}
            </p>
          )}
          {businessAddress && businessAddress.trim().length > 0 && (
            <p className="text-xs text-stone-dark leading-relaxed max-w-xs whitespace-pre-line">
              {businessAddress}
            </p>
          )}
          <p className="text-[11px] text-stone-dark font-mono pt-2">
            © {new Date().getFullYear()} {displayName}. All rights reserved.
          </p>
        </div>

        {/* Column 2: Support & Trust Links */}
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
            Subscribe for quiet collection drops & get a discount on your first order.
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
