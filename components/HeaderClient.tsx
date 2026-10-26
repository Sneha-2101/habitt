"use client";

import Link from "next/link";
import Image from "next/image";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import CartIndicator from "./CartIndicator";
import CartDrawer from "./CartDrawer";
import { useCartStore } from "@/lib/cart-store";

export default function HeaderClient({
  isStaff: initialIsStaff = false,
  isLoggedIn: initialIsLoggedIn = false,
}: {
  isStaff?: boolean;
  isLoggedIn?: boolean;
}) {
  const { data: session } = useSession();
  const { isOpen, open, close } = useCartStore();
  const [logoError, setLogoError] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const router = useRouter();

  const role = (session?.user as { role?: string } | undefined)?.role;
  const isStaff = session ? role === "STAFF" || role === "OWNER" : initialIsStaff;
  const isLoggedIn = session ? !!session.user : initialIsLoggedIn;

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (searchQuery.trim()) {
      router.push(`/shop?q=${encodeURIComponent(searchQuery.trim())}`);
      setShowSearch(false);
      setSearchQuery("");
    }
  }

  return (
    <>
      <header className="sticky top-0 z-20 bg-paper border-b border-stone">
        <div className="grid grid-cols-3 items-center px-4 sm:px-7 py-3.5">
          {/* Left side: Store | Our Story | Sign In / Account */}
          <nav className="flex items-center gap-5 text-[12.5px] tracking-[0.02em]">
            <Link href="/shop" className="hover:opacity-70 transition-opacity font-medium">
              Store
            </Link>
            <Link href="/about" className="text-stone-dark hover:opacity-70 transition-opacity">
              Our Story
            </Link>
            <Link
              href={isLoggedIn ? "/account" : "/login"}
              className="hover:opacity-70 transition-opacity"
            >
              {isLoggedIn ? "Account" : "Sign In"}
            </Link>
            {isStaff && (
              <Link
                href="/admin"
                className="text-moss hover:opacity-70 transition-opacity font-medium"
              >
                Admin
              </Link>
            )}
          </nav>

          {/* Center/brand: habitt logo */}
          <Link href="/" className="flex items-center justify-center">
            {!logoError ? (
              <Image
                src="/logo.png"
                alt="habitt"
                width={130}
                height={40}
                className="h-7 w-auto object-contain"
                priority
                onError={() => setLogoError(true)}
              />
            ) : (
              <span className="font-display italic font-semibold text-xl tracking-tight text-brand">
                habitt
              </span>
            )}
          </Link>

          {/* Right side: Search | Wantlist | My Bag */}
          <nav className="flex items-center justify-end gap-5 text-[12.5px] tracking-[0.02em]">
            {showSearch ? (
              <form onSubmit={handleSearchSubmit} className="flex items-center gap-1">
                <input
                  type="text"
                  placeholder="Search products..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  autoFocus
                  className="px-2.5 py-1 text-[12px] border border-stone bg-white rounded-md focus:outline-none focus:border-ink w-36 sm:w-48"
                />
                <button
                  type="button"
                  onClick={() => setShowSearch(false)}
                  className="text-stone-dark hover:text-ink text-xs px-1"
                >
                  ✕
                </button>
              </form>
            ) : (
              <button
                onClick={() => setShowSearch(true)}
                className="text-stone-dark hover:opacity-70 transition-opacity"
              >
                Search
              </button>
            )}
            <Link href="/wantlist" className="text-stone-dark hover:opacity-70 transition-opacity">
              Wantlist
            </Link>
            <button
              onClick={open}
              className="relative hover:opacity-70 transition-opacity text-[12.5px] tracking-[0.02em]"
            >
              My Bag
              <CartIndicator />
            </button>
          </nav>
        </div>
      </header>

      <CartDrawer isOpen={isOpen} onClose={close} />
    </>
  );
}
