"use client";

import Link from "next/link";
import CartIndicator from "./CartIndicator";
import CartDrawer from "./CartDrawer";
import { useCartStore } from "@/lib/cart-store";

export default function HeaderClient({
  isStaff,
  isLoggedIn,
}: {
  isStaff: boolean;
  isLoggedIn: boolean;
}) {
  const { isOpen, open, close } = useCartStore();

  return (
    <>
      <header className="sticky top-0 z-20 bg-paper border-b border-stone">
        <div className="grid grid-cols-3 items-center px-4 sm:px-7 py-4">
          <nav className="flex items-center gap-5 text-[12.5px] tracking-[0.02em] lowercase">
            <Link href="/shop" className="hover:opacity-70 transition-opacity">shop</Link>
            <Link href="/shop" className="text-stone-dark hover:opacity-70 transition-opacity">journal</Link>
            <Link href="/shop" className="text-stone-dark hover:opacity-70 transition-opacity">about</Link>
          </nav>

          <Link href="/" className="flex items-center justify-center gap-2">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4">
              <path d="M4 20V11a8 8 0 0 1 16 0v9" />
            </svg>
            <span className="font-body text-[16px] lowercase tracking-[0.01em]">habitt</span>
          </Link>

          <nav className="flex items-center justify-end gap-5 text-[12.5px] tracking-[0.02em] lowercase">
            <Link href="/shop" className="text-stone-dark hover:opacity-70 transition-opacity">search</Link>
            {isStaff && (
              <Link href="/admin" className="text-moss hover:opacity-70 transition-opacity">admin</Link>
            )}
            <Link href={isLoggedIn ? "/account" : "/login"} className="hover:opacity-70 transition-opacity">
              {isLoggedIn ? "account" : "sign in"}
            </Link>
            <button
              onClick={open}
              className="relative hover:opacity-70 transition-opacity text-[12.5px] tracking-[0.02em] lowercase"
            >
              cart<CartIndicator />
            </button>
          </nav>
        </div>
      </header>

      <CartDrawer isOpen={isOpen} onClose={close} />
    </>
  );
}
