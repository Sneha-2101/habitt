import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Page Not Found",
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <main className="min-h-[60vh] flex flex-col items-center justify-center px-4 text-center">
      <h1 className="font-display italic text-6xl text-ink mb-4">404</h1>
      <p className="text-[13.5px] text-stone-dark mb-8">
        The piece you are looking for does not exist or has been moved.
      </p>
      <div className="flex items-center gap-4">
        <Link
          href="/"
          className="px-6 py-3 border border-stone text-ink text-[12.5px] tracking-[0.06em] uppercase rounded-none hover:bg-stone/20 transition-colors inline-block"
        >
          Home
        </Link>
        <Link
          href="/shop"
          className="px-6 py-3 bg-ink text-paper text-[12.5px] tracking-[0.06em] uppercase rounded-none hover:bg-opacity-90 transition-opacity inline-block"
        >
          Back to Shop
        </Link>
      </div>
    </main>
  );
}
