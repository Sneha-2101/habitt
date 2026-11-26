import type { Metadata } from "next";
import Script from "next/script";
import { isPhoneOtpBlocked } from "@/lib/whatsapp-flag";
import LoginClient from "./LoginClient";

export const metadata: Metadata = {
  title: "Sign In",
  robots: { index: false, follow: false },
};

export default function LoginPage() {
  const phoneEnabled = !isPhoneOtpBlocked();

  return (
    <main className="max-w-sm mx-auto px-6 py-20 text-center">
      <h1 className="font-display text-2xl mb-6 text-ink font-medium">Sign in to Habitt</h1>
      <LoginClient phoneEnabled={phoneEnabled} />
      {process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY && (
        <Script
          src="https://challenges.cloudflare.com/turnstile/v0/api.js"
          strategy="afterInteractive"
        />
      )}
    </main>
  );
}
