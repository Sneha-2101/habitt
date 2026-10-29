"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Script from "next/script";
import { useCartStore } from "@/lib/cart-store";
import { formatINR } from "@/lib/money";
import { validateCoupon } from "@/lib/actions/coupons";
import { ShippingNote } from "@/lib/pricing/shipping";

declare global {
  interface Window {
    Razorpay: new (options: Record<string, unknown>) => { open: () => void };
  }
}

interface SavedAddress {
  id: string;
  street: string;
  city: string;
  state: string;
  pincode: string;
}

interface QuoteData {
  items: Array<{
    productId: string;
    variantId: string;
    name: string;
    size: string;
    unitPrice: number;
    qty: number;
    lineTotal: number;
  }>;
  subtotal: number;
  discount: number;
  shippingFee: number;
  codFee: number;
  shippingNote: ShippingNote;
  total: number;
  storeCreditApplied: number;
  payable: number;
  cod: {
    eligible: boolean;
    reason?: string;
  };
  warnings: Array<{
    type: string;
    message: string;
  }>;
}

export default function CheckoutPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const { items, clear } = useCartStore();

  const [form, setForm] = useState({
    name: "",
    phone: "",
    email: "",
    line1: "",
    city: "",
    state: "",
    pincode: "",
  });
  const [savedAddresses, setSavedAddresses] = useState<SavedAddress[]>([]);
  const [selectedAddressId, setSelectedAddressId] = useState<string>("NEW");

  const [pendingOrderId, setPendingOrderId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState<string>(() => {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    return "00000000-0000-4000-8000-000000000000";
  });

  // Collapsed Coupon state
  const [showCoupon, setShowCoupon] = useState(false);
  const [couponCodeInput, setCouponCodeInput] = useState("");
  const [appliedCoupon, setAppliedCoupon] = useState<{ code: string; discountAmount: number } | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [isValidatingCoupon, setIsValidatingCoupon] = useState(false);

  // Collapsed Gift Message state
  const [showGiftMessage, setShowGiftMessage] = useState(false);
  const [giftMessage, setGiftMessage] = useState("");

  // Payment Method & Store Credit selection
  const [paymentMethod, setPaymentMethod] = useState<"RAZORPAY" | "COD">("RAZORPAY");
  const [userStoreCreditBalance, setUserStoreCreditBalance] = useState<number>(0);
  const [useStoreCredit, setUseStoreCredit] = useState<boolean>(true);

  // Server Quote State (No price maths in the browser)
  const [quote, setQuote] = useState<QuoteData | null>(null);
  const [isQuoteLoading, setIsQuoteLoading] = useState<boolean>(true);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  // 1. Fetch user profile and saved addresses on mount
  useEffect(() => {
    if (session?.user) {
      setForm((f) => ({
        ...f,
        name: session.user?.name || f.name,
        email: session.user?.email || f.email,
      }));

      fetch("/api/account/profile")
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data?.user?.storeCreditBalance) {
            setUserStoreCreditBalance(data.user.storeCreditBalance);
          }
        })
        .catch(() => {});

      fetch("/api/account/address")
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data?.address) {
            setSavedAddresses([data.address]);
            setSelectedAddressId(data.address.id);
            setForm((f) => ({
              ...f,
              line1: data.address.street,
              city: data.address.city,
              state: data.address.state,
              pincode: data.address.pincode,
            }));
          }
        })
        .catch(() => {});
    }
  }, [session]);

  // 2. Fetch server price quote on load and whenever inputs change (debounced 300ms, abort controller)
  useEffect(() => {
    if (items.length === 0) {
      setQuote(null);
      setIsQuoteLoading(false);
      return;
    }

    const controller = new AbortController();
    setIsQuoteLoading(true);
    setQuoteError(null);

    const timer = setTimeout(async () => {
      try {
        const res = await fetch("/api/checkout/quote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            items: items.map((i) => ({
              productId: i.productId,
              variantId: i.variantId,
              qty: i.qty,
            })),
            paymentMethod,
            couponCode: appliedCoupon?.code || undefined,
            useStoreCredit,
          }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || "Failed to calculate order quote");
        }

        const data: QuoteData = await res.json();
        setQuote(data);

        // Check for coupon-specific warning
        const couponWarn = data.warnings?.find((w) => w.type === "INVALID_COUPON");
        if (couponWarn) {
          setCouponError(couponWarn.message);
          setAppliedCoupon(null);
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name !== "AbortError") {
          setQuoteError(err.message || "Failed to calculate quote");
        } else if (!(err instanceof Error)) {
          setQuoteError("Failed to calculate quote");
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsQuoteLoading(false);
        }
      }
    }, 300);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [items, paymentMethod, appliedCoupon?.code, useStoreCredit]);

  // Meta Pixel track initiate checkout
  useEffect(() => {
    if (quote?.subtotal) {
      import("@/components/MetaPixel").then(({ trackPixelEvent }) => {
        trackPixelEvent("InitiateCheckout", {
          value: quote.subtotal / 100,
          currency: "INR",
          num_items: items.reduce((acc, item) => acc + item.qty, 0),
        });
      });
    }
  }, [quote?.subtotal, items]);

  async function handleApplyCoupon() {
    if (!couponCodeInput.trim()) return;
    setCouponError(null);
    setIsValidatingCoupon(true);
    try {
      const res = await validateCoupon(couponCodeInput, quote?.subtotal || 0);
      if (res.valid) {
        setAppliedCoupon({ code: res.code, discountAmount: res.discountAmount });
        setCouponError(null);
      }
    } catch (err) {
      setCouponError(err instanceof Error ? err.message : "Invalid coupon");
    } finally {
      setIsValidatingCoupon(false);
    }
  }

  const isZeroTotal = quote ? quote.payable === 0 && quote.storeCreditApplied > 0 : false;

  async function handlePay() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/checkout/create-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idempotencyKey,
          orderId: pendingOrderId || undefined,
          paymentMethod,
          useStoreCredit,
          items: items.map((i) => ({
            productId: i.productId,
            variantId: i.variantId,
            size: i.size,
            qty: i.qty,
          })),
          customerName: form.name,
          customerPhone: form.phone,
          customerEmail: form.email || undefined,
          couponCode: appliedCoupon?.code || undefined,
          giftMessage: giftMessage.trim() || undefined,
          shippingAddress: {
            line1: form.line1,
            city: form.city,
            state: form.state,
            pincode: form.pincode,
          },
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        if (data?.retry && typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
          setIdempotencyKey(crypto.randomUUID());
        }
        throw new Error(data.error || "Could not create order");
      }

      if (data.alreadyPaid) {
        clear();
        router.push(`/order/${data.orderId}/success`);
        return;
      }

      setPendingOrderId(data.orderId);

      if (data.isStoreCredit || data.payableAmount === 0 || paymentMethod === "COD" || data.isCod) {
        clear();
        router.push(`/order/${data.orderId}/success`);
        return;
      }

      const rzp = new window.Razorpay({
        key: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
        amount: data.amount,
        currency: data.currency,
        order_id: data.razorpayOrderId,
        name: "Habitt",
        prefill: { name: form.name, contact: form.phone, email: form.email },
        handler: async (response: Record<string, string>) => {
          const verifyRes = await fetch("/api/checkout/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(response),
          });
          const verifyData = await verifyRes.json();
          if (verifyData.verified) {
            clear();
            router.push(`/order/${data.orderId}/success`);
          } else {
            setError("Payment could not be verified. Please contact support with your order id.");
          }
        },
        modal: { ondismiss: () => setLoading(false) },
      });
      rzp.open();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setLoading(false);
    }
  }

  function renderShippingNote(note: ShippingNote) {
    if (note === "FREE_PREPAID") return "Free shipping with online payment";
    if (note === "FREE_THRESHOLD") return "Free shipping (order threshold reached)";
    if (note === "CHARGED") return "Standard shipping";
    return "";
  }

  return (
    <main className="max-w-lg mx-auto px-4 sm:px-7 py-10 sm:py-14">
      <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="lazyOnload" />
      <h1 className="font-display text-2xl mb-6 text-ink font-medium">Checkout</h1>

      {/* Saved Address Selection Dropdown */}
      {savedAddresses.length > 0 && (
        <div className="mb-4">
          <label className="block text-[12px] font-medium text-stone-dark mb-1">Select Shipping Address</label>
          <select
            value={selectedAddressId}
            onChange={(e) => {
              const val = e.target.value;
              setSelectedAddressId(val);
              if (val !== "NEW") {
                const addr = savedAddresses.find((a) => a.id === val);
                if (addr) {
                  setForm((f) => ({
                    ...f,
                    line1: addr.street,
                    city: addr.city,
                    state: addr.state,
                    pincode: addr.pincode,
                  }));
                }
              }
            }}
            className="w-full px-3.5 py-2.5 border border-stone bg-white text-[13px] rounded-sm focus:outline-none focus:border-ink"
          >
            {savedAddresses.map((addr) => (
              <option key={addr.id} value={addr.id}>
                {addr.street}, {addr.city} ({addr.pincode})
              </option>
            ))}
            <option value="NEW">+ Enter a new address</option>
          </select>
        </div>
      )}

      {/* Contact & Shipping Address Form */}
      <div className="flex flex-col gap-3 mb-6">
        <input
          placeholder="Full Name"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className="px-3.5 py-3 border border-stone bg-white text-[13.5px] rounded-sm focus:outline-none focus:border-ink"
        />
        <div className="grid grid-cols-2 gap-3">
          <input
            placeholder="Phone Number"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            className="px-3.5 py-3 border border-stone bg-white text-[13.5px] rounded-sm focus:outline-none focus:border-ink"
          />
          <input
            placeholder="Email Address"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            className="px-3.5 py-3 border border-stone bg-white text-[13.5px] rounded-sm focus:outline-none focus:border-ink"
          />
        </div>
        <input
          placeholder="Street Address / House No."
          value={form.line1}
          onChange={(e) => setForm({ ...form, line1: e.target.value })}
          className="px-3.5 py-3 border border-stone bg-white text-[13.5px] rounded-sm focus:outline-none focus:border-ink"
        />
        <div className="grid grid-cols-3 gap-3">
          <input
            placeholder="City"
            value={form.city}
            onChange={(e) => setForm({ ...form, city: e.target.value })}
            className="px-3.5 py-3 border border-stone bg-white text-[13.5px] rounded-sm focus:outline-none focus:border-ink"
          />
          <input
            placeholder="State"
            value={form.state}
            onChange={(e) => setForm({ ...form, state: e.target.value })}
            className="px-3.5 py-3 border border-stone bg-white text-[13.5px] rounded-sm focus:outline-none focus:border-ink"
          />
          <input
            placeholder="Pincode"
            value={form.pincode}
            onChange={(e) => setForm({ ...form, pincode: e.target.value })}
            className="px-3.5 py-3 border border-stone bg-white text-[13.5px] rounded-sm focus:outline-none focus:border-ink"
          />
        </div>
      </div>

      {/* Collapsed Optional Features: Coupon & Gift Message */}
      <div className="space-y-3 mb-6">
        {/* Store Credit Balance Toggle */}
        {userStoreCreditBalance > 0 && (
          <div className="border border-emerald-300 bg-emerald-50/60 p-3.5 rounded-sm flex items-center justify-between">
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="useStoreCredit"
                checked={useStoreCredit}
                onChange={(e) => setUseStoreCredit(e.target.checked)}
                className="w-4 h-4 accent-emerald-800 cursor-pointer"
              />
              <label htmlFor="useStoreCredit" className="cursor-pointer">
                <span className="text-xs font-semibold text-emerald-950 block">Apply Store Credit</span>
                <span className="text-[11px] text-emerald-800">
                  Available Balance: <strong>{formatINR(userStoreCreditBalance)}</strong>
                </span>
              </label>
            </div>
            {quote && quote.storeCreditApplied > 0 && (
              <span className="text-xs font-mono font-semibold text-emerald-900">
                -{formatINR(quote.storeCreditApplied)}
              </span>
            )}
          </div>
        )}

        {/* Collapsed Coupon Section */}
        <div className="border border-stone/60 bg-white p-3.5 rounded-sm">
          {!showCoupon ? (
            <button
              type="button"
              onClick={() => setShowCoupon(true)}
              className="text-xs font-medium text-ink hover:underline flex items-center justify-between w-full"
            >
              <span>🏷️ Have a coupon code?</span>
              <span className="text-stone-dark">+</span>
            </button>
          ) : (
            <div className="space-y-2">
              <div className="flex justify-between items-center text-xs font-semibold text-ink">
                <span>Apply Coupon</span>
                <button
                  type="button"
                  onClick={() => setShowCoupon(false)}
                  className="text-stone-dark text-[11px]"
                >
                  ✕
                </button>
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="e.g. WELCOME10"
                  value={couponCodeInput}
                  onChange={(e) => setCouponCodeInput(e.target.value)}
                  className="flex-1 px-3 py-1.5 border border-stone text-xs rounded-sm uppercase focus:outline-none focus:border-ink"
                />
                <button
                  type="button"
                  disabled={isValidatingCoupon}
                  onClick={handleApplyCoupon}
                  className="px-3.5 py-1.5 bg-ink text-white text-xs font-medium rounded-sm disabled:opacity-50"
                >
                  {isValidatingCoupon ? "VALIDATING..." : "APPLY"}
                </button>
              </div>
              {appliedCoupon && (
                <div className="flex items-center justify-between text-xs text-moss font-medium">
                  <span>✓ Coupon &quot;{appliedCoupon.code}&quot; applied!</span>
                  <button
                    type="button"
                    onClick={() => {
                      setAppliedCoupon(null);
                      setCouponCodeInput("");
                    }}
                    className="text-stone-dark hover:underline text-[11px]"
                  >
                    Remove
                  </button>
                </div>
              )}
              {couponError && <p className="text-xs text-clay">{couponError}</p>}
            </div>
          )}
        </div>

        {/* Collapsed Gift Message Section */}
        <div className="border border-stone/60 bg-white p-3.5 rounded-sm">
          {!showGiftMessage ? (
            <button
              type="button"
              onClick={() => setShowGiftMessage(true)}
              className="text-xs font-medium text-ink hover:underline flex items-center justify-between w-full"
            >
              <span>🎁 Add a gift message</span>
              <span className="text-stone-dark">+</span>
            </button>
          ) : (
            <div className="space-y-2">
              <div className="flex justify-between items-center text-xs font-semibold text-ink">
                <span>Gift Message</span>
                <button
                  type="button"
                  onClick={() => setShowGiftMessage(false)}
                  className="text-stone-dark text-[11px]"
                >
                  ✕
                </button>
              </div>
              <textarea
                rows={2}
                placeholder="Write a personal note for the recipient..."
                value={giftMessage}
                onChange={(e) => setGiftMessage(e.target.value)}
                className="w-full px-3 py-2 border border-stone text-xs rounded-sm focus:outline-none focus:border-ink"
              />
            </div>
          )}
        </div>
      </div>

      {/* Payment Method Selection */}
      {!isZeroTotal ? (
        <div className="bg-white border border-stone p-4 mb-6 rounded-sm space-y-3">
          <div className="text-[11px] tracking-[0.08em] font-semibold text-stone-dark uppercase">
            Payment Method
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-3 p-3 border border-stone rounded-sm cursor-pointer hover:bg-paper/50">
              <input
                type="radio"
                name="paymentMethod"
                value="RAZORPAY"
                checked={paymentMethod === "RAZORPAY"}
                onChange={() => setPaymentMethod("RAZORPAY")}
                className="w-4 h-4 accent-ink cursor-pointer"
              />
              <div>
                <div className="text-xs font-medium text-ink">Online Payment (Razorpay)</div>
                <div className="text-[11px] text-stone-dark">UPI, Cards, NetBanking (Free shipping on prepaid)</div>
              </div>
            </label>

            <label
              className={`flex items-start gap-3 p-3 border rounded-sm ${
                quote?.cod.eligible
                  ? "border-stone cursor-pointer hover:bg-paper/50"
                  : "border-stone/40 bg-stone/10 cursor-not-allowed opacity-60"
              }`}
            >
              <input
                type="radio"
                name="paymentMethod"
                value="COD"
                disabled={!quote?.cod.eligible}
                checked={paymentMethod === "COD"}
                onChange={() => {
                  if (quote?.cod.eligible) setPaymentMethod("COD");
                }}
                className="w-4 h-4 mt-0.5 accent-ink"
              />
              <div className="flex-1">
                <div className="text-xs font-medium text-ink">Cash on Delivery (COD)</div>
                <div className="text-[11px] text-stone-dark">Pay cash upon delivery</div>
                {!quote?.cod.eligible && quote?.cod.reason && (
                  <p className="text-[11px] text-clay mt-1">
                    {quote.cod.reason}
                  </p>
                )}
              </div>
            </label>
          </div>
        </div>
      ) : (
        <div className="p-4 bg-emerald-50 border border-emerald-300 text-xs text-emerald-900 rounded-sm mb-6 font-medium">
          🎉 Store Credit completely covers your order! No additional payment method required.
        </div>
      )}

      {/* Order Summary & Pricing Breakdown (Exclusively rendered from server quote response) */}
      <div className="bg-white border border-stone p-4 mb-6 text-sm rounded-sm space-y-2">
        <div className="flex justify-between items-center mb-2">
          <div className="text-[11px] tracking-[0.08em] font-semibold text-stone-dark uppercase">
            Order Summary
          </div>
          {isQuoteLoading && (
            <span className="text-[11px] text-stone-dark italic">Updating quote…</span>
          )}
        </div>

        {items.map((i) => (
          <div key={i.variantId} className="flex justify-between text-xs">
            <span>
              {i.name} ({i.size}) × {i.qty}
            </span>
            <span className="font-mono">{formatINR(i.unitPrice * i.qty)}</span>
          </div>
        ))}

        {quote ? (
          <div className="pt-2 mt-2 border-t border-stone/40 text-xs space-y-1">
            <div className="flex justify-between text-stone-dark">
              <span>Subtotal</span>
              <span className="font-mono">{formatINR(quote.subtotal)}</span>
            </div>

            {quote.discount > 0 && (
              <div className="flex justify-between text-moss font-medium">
                <span>Discount {appliedCoupon?.code ? `(${appliedCoupon.code})` : ""}</span>
                <span className="font-mono">-{formatINR(quote.discount)}</span>
              </div>
            )}

            <div className="flex justify-between text-stone-dark">
              <div>
                <span>Shipping</span>
                {quote.shippingNote && (
                  <span className="text-[10px] text-stone-dark block italic">
                    {renderShippingNote(quote.shippingNote)}
                  </span>
                )}
              </div>
              <span className="font-mono">
                {quote.shippingFee === 0 ? "FREE" : formatINR(quote.shippingFee)}
              </span>
            </div>

            {quote.codFee > 0 && (
              <div className="flex justify-between text-amber-800 font-medium">
                <span>COD Handling Fee</span>
                <span className="font-mono">+{formatINR(quote.codFee)}</span>
              </div>
            )}

            {quote.storeCreditApplied > 0 && (
              <div className="flex justify-between text-emerald-800 font-medium">
                <span>Store Credit Applied</span>
                <span className="font-mono">-{formatINR(quote.storeCreditApplied)}</span>
              </div>
            )}

            <div className="flex justify-between font-semibold pt-2 mt-2 border-t border-stone text-sm">
              <span>{isZeroTotal ? "Total Payable" : "Remaining Payable"}</span>
              <span className="font-mono">{formatINR(quote.payable)}</span>
            </div>
          </div>
        ) : quoteError ? (
          <p className="text-xs text-clay py-2">{quoteError}</p>
        ) : (
          <div className="pt-2 text-xs text-stone-dark italic">Loading quote…</div>
        )}
      </div>

      {quote?.warnings && quote.warnings.length > 0 && (
        <div className="mb-4 space-y-1">
          {quote.warnings.map((w, idx) => (
            <p key={idx} className="text-xs text-clay font-medium bg-red-50 p-2 border border-red-200 rounded-sm">
              ⚠ {w.message}
            </p>
          ))}
        </div>
      )}

      {error && <p className="text-clay text-[12.5px] mb-4 font-medium">{error}</p>}

      <button
        onClick={handlePay}
        disabled={loading || items.length === 0 || isQuoteLoading || !quote}
        className="w-full py-3.5 bg-ink text-white text-[13.5px] font-medium tracking-[0.04em] rounded-sm hover:bg-opacity-90 disabled:opacity-50 transition-opacity"
      >
        {loading
          ? "Processing…"
          : isQuoteLoading
          ? "Calculating Total…"
          : !quote
          ? "Checkout"
          : isZeroTotal
          ? "Place Order (Paid with Store Credit)"
          : paymentMethod === "COD"
          ? `Place Order — ${formatINR(quote.payable)} (COD)`
          : `Pay ${formatINR(quote.payable)} with Razorpay`}
      </button>
    </main>
  );
}
