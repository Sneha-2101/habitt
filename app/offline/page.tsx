import Link from "next/link";

export default function OfflinePage() {
  return (
    <main className="max-w-xl mx-auto px-4 sm:px-7 py-20 text-center space-y-5">
      <p className="font-mono text-xs uppercase tracking-widest text-stone-dark">Offline</p>
      <h1 className="font-display text-3xl text-ink font-medium">You appear to be offline</h1>
      <p className="text-sm text-[#4B473F] leading-relaxed">
        Please check your internet connection and try again.
      </p>
      <div className="pt-2">
        <Link
          href="/"
          className="inline-block px-6 py-2.5 bg-ink text-paper text-xs font-mono uppercase tracking-wider hover:opacity-90"
        >
          Try Again
        </Link>
      </div>
    </main>
  );
}
