"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Script from "next/script";
import { useCartStore } from "@/lib/cart-store";
import { formatINR } from "@/lib/money";

import { validateCoupon } from "@/lib/actions/coupons";

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

export default function CheckoutPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const { items, clear } = useCartStore();
  const [form, setForm] = useState({ name: "", phone: "", email: "", line1: "", city: "", state: "", pincode: "" });
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

  // COD Payment Method state
  const [paymentMethod, setPaymentMethod] = useState<"RAZORPAY" | "COD">("RAZORPAY");
  const [codEligibility, setCodEligibility] = useState<{
    eligible: boolean;
    reason?: "cod_disabled" | "order_cap_exceeded" | "requires_first_delivery";
    message?: string;
  } | null>(null);

  // SiteSettings state for dynamic shipping & COD fee calculation
  const [siteSettings, setSiteSettings] = useState<{
    shippingFee: number;
    freeShippingThreshold: number;
    codFeeEnabled: boolean;
    codFee: number;
  }>({
    shippingFee: 9900,
    freeShippingThreshold: 299900,
    codFeeEnabled: false,
    codFee: 0,
  });

  // Store Credit state
  const [userStoreCreditBalance, setUserStoreCreditBalance] = useState<number>(0);
  const [useStoreCredit, setUseStoreCredit] = useState<boolean>(true);

  const subtotal = items.reduce((s, i) => s + i.unitPrice * i.qty, 0);
  const shippingFee = subtotal >= siteSettings.freeShippingThreshold ? 0 : siteSettings.shippingFee;
  const codSurcharge = (paymentMethod === "COD" && siteSettings.codFeeEnabled) ? siteSettings.codFee : 0;
  const discountAmount = appliedCoupon?.discountAmount || 0;
  const grossTotal = Math.max(0, subtotal - discountAmount + shippingFee + codSurcharge);

  const storeCreditApplied = useStoreCredit ? Math.min(userStoreCreditBalance, grossTotal) : 0;
  const finalTotal = Math.max(0, grossTotal - storeCreditApplied);
  const isZeroTotal = finalTotal === 0;

  useEffect(() => {
    // Track InitiateCheckout Meta Pixel Event
    import("@/components/MetaPixel").then(({ trackPixelEvent }) => {
      trackPixelEvent("InitiateCheckout", {
        value: (subtotal / 100),
        currency: "INR",
        num_items: items.reduce((acc, item) => acc + item.qty, 0),
      });
    });

    // Site settings and COD eligibility checks are performed server-side on checkout/create-order
    if (session?.user) {
      const userId = (session.user as { id?: string }).id;
      setForm((f) => ({ ...f, name: session.user?.name || f.name, email: session.user?.email || f.email }));
      
      // Fetch user store credit balance and saved address
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
  }, [session, subtotal]);

  async function handleApplyCoupon() {
    if (!couponCodeInput.trim()) return;
    setCouponError(null);
    setIsValidatingCoupon(true);
    try {
      const res = await validateCoupon(couponCodeInput, subtotal);
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
          shippingAddress: { line1: form.line1, city: form.city, state: form.state, pincode: form.pincode },
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

  return (
    <main className="max-w-lg mx-auto px-4 sm:px-7 py-10 sm:py-14">
      <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="lazyOnload" />
      <h1 className="font-display text-2xl mb-6 text-ink font-medium">Checkout</h1>

      {/* Saved Address Selection Dropdown (if logged in & addresses exist) */}
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
                  setForm((f) => ({ ...f, line1: addr.street, city: addr.city, state: addr.state, pincode: addr.pincode }));
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
            <span className="text-xs font-mono font-semibold text-emerald-900">
              -{formatINR(storeCreditApplied)}
            </span>
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
                <button type="button" onClick={() => setShowCoupon(false)} className="text-stone-dark text-[11px]">✕</button>
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
                <p className="text-xs text-moss font-medium">
                  ✓ Coupon "{appliedCoupon.code}" applied! Savings: {formatINR(appliedCoupon.discountAmount)}
                </p>
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
                <button type="button" onClick={() => setShowGiftMessage(false)} className="text-stone-dark text-[11px]">✕</button>
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

      {/* Payment Method Selection (hidden if store credit completely covers total) */}
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
                <div className="text-[11px] text-stone-dark">UPI, Cards, NetBanking</div>
              </div>
            </label>

            {codEligibility?.eligible ? (
              <label className="flex items-center gap-3 p-3 border border-stone rounded-sm cursor-pointer hover:bg-paper/50">
                <input
                  type="radio"
                  name="paymentMethod"
                  value="COD"
                  checked={paymentMethod === "COD"}
                  onChange={() => setPaymentMethod("COD")}
                  className="w-4 h-4 accent-ink cursor-pointer"
                />
                <div>
                  <div className="text-xs font-medium text-ink">Cash on Delivery (COD)</div>
                  <div className="text-[11px] text-stone-dark">Pay cash upon delivery</div>
                </div>
              </label>
            ) : (
              codEligibility && codEligibility.reason !== "cod_disabled" && (
                <div className="p-2.5 bg-paper text-[11.5px] text-stone-dark border border-stone/50 rounded-sm">
                  ℹ️ {codEligibility.message}
                </div>
              )
            )}
          </div>
        </div>
      ) : (
        <div className="p-4 bg-emerald-50 border border-emerald-300 text-xs text-emerald-900 rounded-sm mb-6 font-medium">
          🎉 Store Credit completely covers your order! No additional payment method required.
        </div>
      )}

      {/* Order Summary & Pricing Breakdown */}
      <div className="bg-white border border-stone p-4 mb-6 text-sm rounded-sm space-y-2">
        <div className="text-[11px] tracking-[0.08em] font-semibold text-stone-dark uppercase mb-2">Order Summary</div>
        {items.map((i) => (
          <div key={i.variantId} className="flex justify-between text-xs">
            <span>{i.name} ({i.size}) × {i.qty}</span>
            <span className="font-mono">{formatINR(i.unitPrice * i.qty)}</span>
          </div>
        ))}
        <div className="pt-2 mt-2 border-t border-stone/40 text-xs space-y-1">
          <div className="flex justify-between text-stone-dark">
            <span>Subtotal</span>
            <span className="font-mono">{formatINR(subtotal)}</span>
          </div>
          {appliedCoupon && (
            <div className="flex justify-between text-moss font-medium">
              <span>Discount ({appliedCoupon.code})</span>
              <span className="font-mono">-{formatINR(discountAmount)}</span>
            </div>
          )}
          <div className="flex justify-between text-stone-dark">
            <span>Shipping</span>
            <span className="font-mono">{shippingFee === 0 ? "FREE" : formatINR(shippingFee)}</span>
          </div>
          {codSurcharge > 0 && (
            <div className="flex justify-between text-amber-800 font-medium">
              <span>COD Handling Fee</span>
              <span className="font-mono">+{formatINR(codSurcharge)}</span>
            </div>
          )}
          {storeCreditApplied > 0 && (
            <div className="flex justify-between text-emerald-800 font-medium">
              <span>Store Credit Applied</span>
              <span className="font-mono">-{formatINR(storeCreditApplied)}</span>
            </div>
          )}
        </div>
        <div className="flex justify-between font-semibold pt-2 mt-2 border-t border-stone text-sm">
          <span>{isZeroTotal ? "Total Payable" : "Remaining Payable"}</span>
          <span className="font-mono">{formatINR(finalTotal)}</span>
        </div>
      </div>

      {error && <p className="text-clay text-[12.5px] mb-4 font-medium">{error}</p>}

      <button
        onClick={handlePay}
        disabled={loading || items.length === 0}
        className="w-full py-3.5 bg-ink text-white text-[13.5px] font-medium tracking-[0.04em] rounded-sm hover:bg-opacity-90 disabled:opacity-50 transition-opacity"
      >
        {loading
          ? "Processing…"
          : isZeroTotal
          ? "Place Order (Paid with Store Credit)"
          : paymentMethod === "COD"
          ? `Place Order — ${formatINR(finalTotal)} (COD)`
          : `Pay ${formatINR(finalTotal)} with Razorpay`}
      </button>
    </main>
  );
}
