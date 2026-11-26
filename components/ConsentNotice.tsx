"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CONSENT_EVENT,
  CONSENT_OPEN_EVENT,
  dismissConsentForSession,
  grantConsent,
  isConsentDismissed,
  readConsent,
  revokeConsent,
} from "@/lib/consent/consent";

const PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID?.trim();

export default function ConsentNotice() {
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const [isGranted, setIsGranted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const sync = () => {
      const granted = readConsent() === "granted";
      setIsGranted(granted);
      setVisible(!granted && !isConsentDismissed());
    };
    sync();

    const handleOpen = () => {
      setIsGranted(readConsent() === "granted");
      setVisible(true);
    };

    window.addEventListener(CONSENT_EVENT, sync);
    window.addEventListener(CONSENT_OPEN_EVENT, handleOpen);
    return () => {
      window.removeEventListener(CONSENT_EVENT, sync);
      window.removeEventListener(CONSENT_OPEN_EVENT, handleOpen);
    };
  }, []);

  if (!PIXEL_ID || PIXEL_ID === "YOUR_META_PIXEL_ID") {
    return null;
  }

  if (!mounted || !visible) {
    return null;
  }

  if (pathname?.startsWith("/admin") || pathname?.startsWith("/staff")) {
    return null;
  }

  return (
    <div
      role="dialog"
      aria-label="Cookie consent"
      className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-5 sm:max-w-sm z-50 border border-stone bg-paper text-ink p-4 shadow-lg"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs text-[#4B473F] leading-relaxed">
          We use marketing cookies (Meta Pixel) to measure ad performance.{" "}
          <Link href="/policies/privacy" className="underline text-ink">
            Privacy Policy
          </Link>
        </p>
        <button
          type="button"
          aria-label="Dismiss cookie notice"
          onClick={() => {
            dismissConsentForSession();
            setVisible(false);
          }}
          className="text-xs text-stone-dark hover:text-ink px-1 leading-none"
        >
          &times;
        </button>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            grantConsent();
            setVisible(false);
          }}
          className="px-4 py-1.5 bg-ink text-paper text-[11px] uppercase tracking-[0.06em] hover:opacity-90"
        >
          Accept
        </button>
        {isGranted && (
          <button
            type="button"
            onClick={() => {
              revokeConsent();
              setVisible(false);
              window.location.reload();
            }}
            className="px-3 py-1.5 border border-stone text-ink text-[11px] uppercase tracking-[0.06em] hover:border-ink"
          >
            Withdraw consent
          </button>
        )}
      </div>
    </div>
  );
}
