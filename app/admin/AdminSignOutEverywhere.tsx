"use client";

import { useState } from "react";
import { signOutEverywhereAction } from "@/lib/actions/sessions";

export default function AdminSignOutEverywhere() {
  const [loading, setLoading] = useState(false);

  async function handleSignOutEverywhere() {
    if (!confirm("Are you sure you want to sign out of all devices? This will invalidate all your active sessions.")) {
      return;
    }
    setLoading(true);
    try {
      await signOutEverywhereAction();
      window.location.href = "/staff/login";
    } catch (err) {
      console.error(err);
      window.location.href = "/staff/login";
    }
  }

  return (
    <button
      type="button"
      disabled={loading}
      onClick={handleSignOutEverywhere}
      className="text-xs text-red-600 hover:text-red-800 underline disabled:opacity-50"
    >
      {loading ? "Signing out..." : "Sign out all devices"}
    </button>
  );
}

