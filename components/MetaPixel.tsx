"use client";

import { useEffect, useRef, useState } from "react";
import Script from "next/script";
import { usePathname } from "next/navigation";
import {
  CONSENT_EVENT,
  purchaseDedupeKey,
  readConsent,
  shouldLoadPixel,
} from "@/lib/consent/consent";
import { flushPixelQueue, queuePixelEvent } from "@/lib/consent/pixel-queue";
import { buildPurchasePayload } from "@/lib/consent/pixel-payload";
import type { FeedVariantIdInput } from "@/lib/seo/feed-id";

const PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID?.trim();

type FbqFn = ((
  command: string,
  eventNameOrId: string,
  params?: Record<string, unknown>,
  eventData?: { eventID?: string }
) => void) & {
  callMethod?: (...args: unknown[]) => void;
  queue?: unknown[];
  push?: unknown;
  loaded?: boolean;
  version?: string;
};

declare global {
  interface Window {
    fbq?: FbqFn;
  }
}

function getSafeLocalStorage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function trackPixelEvent(
  eventName: string,
  data?: Record<string, unknown>,
  options?: { eventID?: string }
) {
  if (typeof window === "undefined") return;
  if (!shouldLoadPixel({ pixelId: PIXEL_ID, consent: readConsent() })) return;
  if (window.fbq) {
    try {
      window.fbq("track", eventName, data, options);
    } catch (err) {
      console.warn("[Meta Pixel Warning]:", err);
    }
    return;
  }
  queuePixelEvent({ eventName, data, options });
}

export function trackPurchaseOnce(
  orderId: string,
  totalRupees: number,
  items?: ReadonlyArray<FeedVariantIdInput>
) {
  if (typeof window === "undefined") return;
  if (!shouldLoadPixel({ pixelId: PIXEL_ID, consent: readConsent() })) return;

  const key = purchaseDedupeKey(orderId);
  const storage = getSafeLocalStorage();
  try {
    if (storage?.getItem(key) === "1") return;
  } catch {
    // ignore storage read errors
  }

  const data = buildPurchasePayload({ orderId, totalRupees, items });
  const options = { eventID: orderId };

  if (window.fbq) {
    try {
      window.fbq("track", "Purchase", data, options);
      try {
        storage?.setItem(key, "1");
      } catch {
        // ignore storage write errors
      }
    } catch (err) {
      console.warn("[Meta Pixel Warning]:", err);
    }
    return;
  }

  queuePixelEvent(
    {
      eventName: "Purchase",
      data,
      options,
      purchaseOrderId: orderId,
      dedupeKey: key,
    },
    storage
  );
}

export default function MetaPixel() {
  const pathname = usePathname();
  const [allowed, setAllowed] = useState(false);
  const lastTrackedPathRef = useRef<string | null>(null);

  useEffect(() => {
    const sync = () => {
      setAllowed(shouldLoadPixel({ pixelId: PIXEL_ID, consent: readConsent() }));
    };
    sync();
    window.addEventListener(CONSENT_EVENT, sync);
    return () => window.removeEventListener(CONSENT_EVENT, sync);
  }, []);

  useEffect(() => {
    if (!allowed) return;

    const tryFlush = () => {
      if (!window.fbq) return false;
      try {
        flushPixelQueue(window.fbq, getSafeLocalStorage());
      } catch (err) {
        console.warn("[Meta Pixel Warning]:", err);
      }
      return true;
    };

    if (tryFlush()) return;

    let elapsed = 0;
    const intervalMs = 100;
    const maxMs = 10000;
    const timer = window.setInterval(() => {
      elapsed += intervalMs;
      if (tryFlush() || elapsed >= maxMs) {
        window.clearInterval(timer);
      }
    }, intervalMs);

    return () => window.clearInterval(timer);
  }, [allowed]);

  useEffect(() => {
    if (!allowed || !pathname) return;
    if (lastTrackedPathRef.current === null) {
      lastTrackedPathRef.current = pathname;
      return;
    }
    if (lastTrackedPathRef.current !== pathname) {
      lastTrackedPathRef.current = pathname;
      trackPixelEvent("PageView");
    }
  }, [allowed, pathname]);

  if (!allowed || !PIXEL_ID || PIXEL_ID === "YOUR_META_PIXEL_ID") {
    return null;
  }

  return (
    <Script
      id="meta-pixel-script"
      strategy="afterInteractive"
      dangerouslySetInnerHTML={{
        __html: `
          !function(f,b,e,v,n,t,s)
          {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
          n.callMethod.apply(n,arguments):n.queue.push(arguments)};
          if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
          n.queue=[];t=b.createElement(e);t.async=!0;
          t.src=v;s=b.getElementsByTagName(e)[0];
          s.parentNode.insertBefore(t,s)}(window, document,'script',
          'https://connect.facebook.net/en_US/fbevents.js');
          fbq('init', '${PIXEL_ID}');
          fbq('track', 'PageView');
        `,
      }}
    />
  );
}
