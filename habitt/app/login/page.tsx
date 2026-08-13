"use client";

import { Suspense, useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirect") || "/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const res = await signIn("credentials", { email, password, redirect: false });
    if (res?.error) {
      setError("Incorrect email or password");
    } else {
      const target = searchParams.get("redirect");
      if (target) {
        router.push(target);
      } else {
        // If staff/owner signs in without explicit redirect, go straight to /admin
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
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <input
        type="email"
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="px-3.5 py-3 border border-stone bg-card text-[13.5px]"
      />
      <input
        type="password"
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="px-3.5 py-3 border border-stone bg-card text-[13.5px]"
      />
      {error && <p className="text-clay text-[12px]">{error}</p>}
      <button type="submit" className="py-3 bg-ink text-paper text-[13px] tracking-[0.04em]">
        SIGN IN
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="max-w-xs mx-auto px-7 py-24 text-center">
      <h1 className="font-display text-2xl mb-6">Sign in</h1>
      <Suspense fallback={<div className="text-xs text-stone-dark">Loading...</div>}>
        <LoginForm />
      </Suspense>
      <p className="text-[12.5px] text-stone-dark mt-5">
        New here?{" "}
        <Link href="/signup" className="underline text-ink">
          Create an account
        </Link>
      </p>
    </main>
  );
}
