"use client";

import { openConsentNotice } from "@/lib/consent/consent";

const PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID?.trim();

export default function CookieSettingsLink() {
  if (!PIXEL_ID || PIXEL_ID === "YOUR_META_PIXEL_ID") {
    return null;
  }

  return (
    <button
      type="button"
      onClick={() => openConsentNotice()}
      className="hover:underline text-ink text-left"
    >
      Cookie settings
    </button>
  );
}
