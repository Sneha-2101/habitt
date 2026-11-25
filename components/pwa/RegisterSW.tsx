"use client";

import { useEffect } from "react";

export default function RegisterSW() {
  useEffect(() => {
    if (
      process.env.NODE_ENV === "production" &&
      typeof window !== "undefined" &&
      window.isSecureContext &&
      "serviceWorker" in navigator
    ) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Silent registration failure
      });
    }
  }, []);

  return null;
}
