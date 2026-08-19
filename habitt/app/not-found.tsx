import Link from "next/link";

export default function NotFound() {
  return (
    <main className="max-w-md mx-auto px-4 sm:px-7 py-24 text-center">
      <h1 className="font-display italic text-4xl mb-3 font-medium">404</h1>
      <p className="text-stone-dark text-[14px] mb-8">
        This page doesn't exist or has moved.
      </p>
      <Link
        href="/shop"
        className="inline-block px-7 py-3 bg-ink text-paper text-[13px] tracking-[0.06em] uppercase hover:opacity-90 transition-opacity"
      >
        Back to Shop
      </Link>
    </main>
  );
}
