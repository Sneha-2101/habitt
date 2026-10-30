"use client";

import { Suspense, useState, useEffect } from "react";
import Script from "next/script";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { requestStaffOtpAction } from "@/lib/actions/staff-auth";
import { safeRedirect } from "@/lib/safe-redirect";

function StaffLoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [cooldown, setCooldown] = useState(0);
  const [isDevMode, setIsDevMode] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [error, setError] = useState("");
  const [infoMessage, setInfoMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (cooldown > 0) {
      timer = setTimeout(() => setCooldown((prev) => prev - 1), 1000);
    }
    return () => clearTimeout(timer);
  }, [cooldown]);

  useEffect(() => {
    if (turnstileSiteKey && typeof window !== "undefined") {
      (window as unknown as { onTurnstileSuccess?: (token: string) => void }).onTurnstileSuccess = (token: string) => {
        setTurnstileToken(token);
      };
    }
  }, [turnstileSiteKey]);

  async function handleSendOtp(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setInfoMessage("");
    setLoading(true);
    setIsDevMode(false);

    const rawEmail = email.trim().toLowerCase();
    if (!rawEmail || !rawEmail.includes("@")) {
      setError("Please enter a valid email address.");
      setLoading(false);
      return;
    }

    const res = await requestStaffOtpAction(rawEmail, turnstileToken || undefined);
    setLoading(false);

    if (!res.success) {
      setError(res.error || "Failed to send verification code");
      return;
    }

    setInfoMessage(res.message || "If this email has staff access, a code has been sent.");
    setStep("code");
    setCooldown(30);
    setIsDevMode(!!res.devMode);
  }

  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const trimmedCode = code.trim();
    if (!trimmedCode || trimmedCode.length !== 6) {
      setError("Please enter the 6-digit code");
      return;
    }

    setLoading(true);
    const res = await signIn("staff-otp", {
      email: email.trim().toLowerCase(),
      code: trimmedCode,
      redirect: false,
    });
    setLoading(false);

    if (res?.error) {
      setError("Invalid or expired verification code");
    } else {
      const target = searchParams.get("redirect") || "/admin";
      router.push(safeRedirect(target));
      router.refresh();
    }
  }

  return (
    <div className="space-y-6">
      {/* Dev Mode Banner */}
      {isDevMode && (
        <div className="p-2.5 bg-amber-50 border border-amber-200 text-amber-900 text-[11.5px] rounded-xs">
          <strong>[Dev Mode]</strong> Dev mode: code printed in the server terminal.
        </div>
      )}

      {infoMessage && (
        <div className="p-2.5 bg-stone-light text-ink text-xs rounded-xs">
          {infoMessage}
        </div>
      )}

      {error && (
        <div className="p-2.5 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xs">
          {error}
        </div>
      )}

      {step === "email" ? (
        <form onSubmit={handleSendOtp} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-stone-dark mb-1">
              Staff Email Address
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@habitt.com"
              required
              disabled={loading}
              className="w-full px-3 py-2 border border-stone rounded-xs text-sm focus:outline-none focus:border-ink"
            />
          </div>

          {turnstileSiteKey && (
            <div
              className="cf-turnstile my-2"
              data-sitekey={turnstileSiteKey}
              data-callback="onTurnstileSuccess"
              data-theme="light"
              data-size="flexible"
            />
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-ink text-paper text-xs font-semibold uppercase tracking-wider rounded-xs hover:bg-ink-light disabled:opacity-50 transition-colors"
          >
            {loading ? "Sending Code..." : "Send Verification Code"}
          </button>
        </form>
      ) : (
        <form onSubmit={handleVerifyOtp} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-stone-dark mb-1">
              6-digit code sent to {email}
            </label>
            <input
              type="text"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="000000"
              required
              disabled={loading}
              className="w-full px-3 py-2 border border-stone rounded-xs text-center tracking-widest text-lg font-mono focus:outline-none focus:border-ink"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-ink text-paper text-xs font-semibold uppercase tracking-wider rounded-xs hover:bg-ink-light disabled:opacity-50 transition-colors"
          >
            {loading ? "Signing in..." : "Verify & Sign In"}
          </button>

          <div className="flex items-center justify-between text-xs text-stone-dark pt-2">
            <button
              type="button"
              onClick={() => {
                setStep("email");
                setCode("");
                setError("");
              }}
              className="underline hover:text-ink"
            >
              Use different email
            </button>
            <button
              type="button"
              disabled={cooldown > 0 || loading}
              onClick={handleSendOtp}
              className="underline hover:text-ink disabled:no-underline disabled:opacity-50"
            >
              {cooldown > 0 ? `Resend code (${cooldown}s)` : "Resend code"}
            </button>
          </div>
        </form>
      )}

      {turnstileSiteKey && (
        <Script
          src="https://challenges.cloudflare.com/turnstile/v0/api.js"
          async
          defer
        />
      )}
    </div>
  );
}

export default function StaffLoginPage() {
  return (
    <div className="min-h-[70vh] flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <h2 className="text-center font-display text-2xl tracking-tight text-ink">
          Habitt Staff Portal
        </h2>
        <p className="mt-1 text-center text-xs text-stone-dark">
          Restricted access for authorized personnel only
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-paper py-8 px-6 shadow-sm border border-stone rounded-xs sm:px-10">
          <Suspense fallback={<div className="text-center text-xs text-stone-dark">Loading...</div>}>
            <StaffLoginForm />
          </Suspense>
        </div>
      </div>
    </div>
  );
}

