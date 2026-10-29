"use client";

import { Suspense, useState, useEffect } from "react";
import Script from "next/script";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { requestOtpAction } from "@/lib/actions/otp";
import { safeRedirect } from "@/lib/safe-redirect";

type TabType = "phone" | "emailCode" | "password";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<TabType>("phone");

  // Input states
  const [phone, setPhone] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [passwordEmail, setPasswordEmail] = useState("");
  const [password, setPassword] = useState("");

  // OTP flow states
  const [otpSent, setOtpSent] = useState(false);
  const [normalizedIdentifier, setNormalizedIdentifier] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const [isDevMode, setIsDevMode] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");
  const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

  // General states
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

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

  function resetFormState() {
    setOtpSent(false);
    setNormalizedIdentifier("");
    setOtpCode("");
    setError("");
    setLoading(false);
    setIsDevMode(false);
    setTurnstileToken("");
  }

  function handleTabChange(tab: TabType) {
    setActiveTab(tab);
    resetFormState();
  }

  async function handleSendOtp(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    setIsDevMode(false);

    const channel = activeTab === "phone" ? "PHONE" : "EMAIL";
    const rawIdentifier = activeTab === "phone" ? phone : emailCode;

    if (!rawIdentifier.trim()) {
      setError(activeTab === "phone" ? "Please enter a valid phone number" : "Please enter a valid email address");
      setLoading(false);
      return;
    }

    const res = await requestOtpAction(rawIdentifier, channel, turnstileToken || undefined);
    setLoading(false);

    if (!res.success || !res.identifier) {
      setError(res.error || "Failed to send verification code");
      return;
    }

    setNormalizedIdentifier(res.identifier);
    setOtpSent(true);
    setCooldown(30);
    setIsDevMode(!!res.devMode);
  }

  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!otpCode.trim() || otpCode.trim().length !== 6) {
      setError("Please enter the 6-digit code");
      return;
    }

    setLoading(true);
    const res = await signIn("otp", {
      identifier: normalizedIdentifier,
      code: otpCode.trim(),
      redirect: false,
    });
    setLoading(false);

    if (res?.error) {
      setError("Invalid or expired verification code");
    } else {
      await handleLoginSuccess();
    }
  }

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const res = await signIn("credentials", {
      email: passwordEmail,
      password,
      redirect: false,
    });
    setLoading(false);

    if (res?.error) {
      setError("Incorrect email or password");
    } else {
      await handleLoginSuccess();
    }
  }

  async function handleLoginSuccess() {
    const target = searchParams.get("redirect");
    if (target) {
      router.push(safeRedirect(target));
    } else {
      const sessionRes = await fetch("/api/auth/session");
      const sessionData = await sessionRes.json();
      const role = sessionData?.user?.role;
      if (role === "STAFF" || role === "OWNER") {
        router.push("/admin");
      } else {
        router.push("/");
      }
    }
    router.refresh();
  }

  return (
    <div className="space-y-6">
      {/* 3 Login Tabs */}
      <div className="flex border-b border-stone text-xs font-medium text-stone-dark">
        <button
          type="button"
          onClick={() => handleTabChange("phone")}
          className={`flex-1 py-2.5 text-center border-b-2 transition-colors ${
            activeTab === "phone"
              ? "border-ink text-ink font-semibold"
              : "border-transparent hover:text-ink"
          }`}
        >
          Phone Code
        </button>
        <button
          type="button"
          onClick={() => handleTabChange("emailCode")}
          className={`flex-1 py-2.5 text-center border-b-2 transition-colors ${
            activeTab === "emailCode"
              ? "border-ink text-ink font-semibold"
              : "border-transparent hover:text-ink"
          }`}
        >
          Email Code
        </button>
        <button
          type="button"
          onClick={() => handleTabChange("password")}
          className={`flex-1 py-2.5 text-center border-b-2 transition-colors ${
            activeTab === "password"
              ? "border-ink text-ink font-semibold"
              : "border-transparent hover:text-ink"
          }`}
        >
          Password
        </button>
      </div>

      {/* Dev Mode Banner */}
      {isDevMode && (
        <div className="p-2.5 bg-amber-50 border border-amber-200 text-amber-900 text-[11.5px] rounded-xs">
          <strong>[Dev Mode]</strong> Meta API keys unset. OTP logged to server terminal console.
        </div>
      )}

      {/* Phone / Email OTP Tab Content */}
      {(activeTab === "phone" || activeTab === "emailCode") && (
        <>
          {!otpSent ? (
            <form onSubmit={handleSendOtp} className="flex flex-col gap-3">
              {activeTab === "phone" ? (
                <div>
                  <input
                    type="tel"
                    placeholder="Mobile number (e.g. +91 98765 43210)"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    required
                    className="w-full px-3.5 py-3 border border-stone bg-card text-[13.5px] focus:outline-none focus:border-ink"
                  />
                  <p className="text-[11px] text-stone-dark mt-1 text-left">
                    We will send a 6-digit code via WhatsApp.
                  </p>
                </div>
              ) : (
                <div>
                  <input
                    type="email"
                    placeholder="Email address"
                    value={emailCode}
                    onChange={(e) => setEmailCode(e.target.value)}
                    required
                    autoCapitalize="none"
                    autoCorrect="off"
                    className="w-full px-3.5 py-3 border border-stone bg-card text-[13.5px] focus:outline-none focus:border-ink"
                  />
                  <p className="text-[11px] text-stone-dark mt-1 text-left">
                    We will email you a 6-digit verification code.
                  </p>
                </div>
              )}

              {turnstileSiteKey && (
                <div
                  className="cf-turnstile my-1 flex justify-center"
                  data-sitekey={turnstileSiteKey}
                  data-callback="onTurnstileSuccess"
                />
              )}

              {error && <p className="text-clay text-[12px] text-left">{error}</p>}

              <button
                type="submit"
                disabled={loading}
                className="py-3 bg-ink text-paper text-[13px] tracking-[0.04em] disabled:opacity-50"
              >
                {loading ? "SENDING CODE..." : "SEND CODE"}
              </button>
            </form>
          ) : (
            <form onSubmit={handleVerifyOtp} className="flex flex-col gap-3">
              <div className="text-left bg-paper p-3 border border-stone/50 text-[12px]">
                <span className="text-stone-dark">Code sent to: </span>
                <span className="font-mono font-medium text-ink block truncate">{normalizedIdentifier}</span>
                <button
                  type="button"
                  onClick={resetFormState}
                  className="text-[11px] text-stone-dark underline hover:text-ink mt-1 block"
                >
                  Change identifier
                </button>
              </div>

              <input
                type="text"
                maxLength={6}
                placeholder="Enter 6-digit code"
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ""))}
                autoFocus
                required
                className="px-3.5 py-3 border border-stone bg-card text-center font-mono text-lg tracking-[0.25em] focus:outline-none focus:border-ink"
              />

              {error && <p className="text-clay text-[12px] text-left">{error}</p>}

              <button
                type="submit"
                disabled={loading || otpCode.length !== 6}
                className="py-3 bg-ink text-paper text-[13px] tracking-[0.04em] disabled:opacity-50"
              >
                {loading ? "VERIFYING..." : "VERIFY & SIGN IN"}
              </button>

              <div className="text-xs text-stone-dark pt-1">
                {cooldown > 0 ? (
                  <span>Resend code in {cooldown}s</span>
                ) : (
                  <button
                    type="button"
                    onClick={handleSendOtp}
                    disabled={loading}
                    className="underline text-ink hover:text-stone-dark font-medium"
                  >
                    Resend code
                  </button>
                )}
              </div>
            </form>
          )}
        </>
      )}

      {/* Password Tab Content */}
      {activeTab === "password" && (
        <form onSubmit={handlePasswordSubmit} className="flex flex-col gap-3">
          <input
            type="email"
            placeholder="Email address"
            value={passwordEmail}
            onChange={(e) => setPasswordEmail(e.target.value)}
            required
            autoCapitalize="none"
            autoCorrect="off"
            className="px-3.5 py-3 border border-stone bg-card text-[13.5px] focus:outline-none focus:border-ink"
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="px-3.5 py-3 border border-stone bg-card text-[13.5px] focus:outline-none focus:border-ink"
          />

          {error && <p className="text-clay text-[12px] text-left">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="py-3 bg-ink text-paper text-[13px] tracking-[0.04em] disabled:opacity-50"
          >
            {loading ? "SIGNING IN..." : "SIGN IN"}
          </button>
        </form>
      )}
    </div>
  );
}

export default function LoginPage() {
  return (
    <main className="max-w-sm mx-auto px-6 py-20 text-center">
      <h1 className="font-display text-2xl mb-6 text-ink font-medium">Sign in to Habitt</h1>
      <Suspense fallback={<div className="text-xs text-stone-dark py-8">Loading...</div>}>
        <LoginForm />
      </Suspense>
      <p className="text-[12.5px] text-stone-dark mt-6">
        New here?{" "}
        <Link href="/signup" className="underline text-ink hover:text-stone-dark">
          Create an account
        </Link>
      </p>
      {process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY && (
        <Script
          src="https://challenges.cloudflare.com/turnstile/v0/api.js"
          strategy="afterInteractive"
        />
      )}
    </main>
  );
}
