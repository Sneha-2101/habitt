import Link from "next/link";
import { signUp } from "@/lib/actions/auth";

export default function SignupPage() {
  return (
    <main className="max-w-xs mx-auto px-7 py-24 text-center">
      <h1 className="font-display text-2xl mb-6">Create account</h1>
      <form action={signUp} className="flex flex-col gap-3">
        <input name="name" placeholder="Full name" required className="px-3.5 py-3 border border-stone bg-card text-[13.5px]" />
        <input name="email" type="email" placeholder="Email" required className="px-3.5 py-3 border border-stone bg-card text-[13.5px]" />
        <input name="phone" placeholder="Phone" className="px-3.5 py-3 border border-stone bg-card text-[13.5px]" />
        <input name="password" type="password" placeholder="Password" required className="px-3.5 py-3 border border-stone bg-card text-[13.5px]" />
        <button type="submit" className="py-3 bg-ink text-paper text-[13px] tracking-[0.04em]">
          CREATE ACCOUNT
        </button>
      </form>
      <p className="text-[12.5px] text-stone-dark mt-5">
        Already have an account?{" "}
        <Link href="/login" className="underline text-ink">Sign in</Link>
      </p>
    </main>
  );
}
