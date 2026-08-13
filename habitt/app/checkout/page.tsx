"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Script from "next/script";
import { useCartStore } from "@/lib/cart-store";
import { formatINR } from "@/lib/money";

declare global {
  interface Window {
    Razorpay: new (options: Record<string, unknown>) => { open: () => void };
  }
}

export default function CheckoutPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const { items, clear } = useCartStore();
  const [form, setForm] = useState({ name: "", phone: "", email: "", line1: "", city: "", state: "", pincode: "" });
  const [pendingOrderId, setPendingOrderId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (session?.user) {
      setForm((f) => ({ ...f, name: session.user?.name || f.name, email: session.user?.email || f.email }));
    }
  }, [session]);

  const subtotal = items.reduce((s, i) => s + i.unitPrice * i.qty, 0);

  async function handlePay() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/checkout/create-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: pendingOrderId || undefined,
          items: items.map((i) => ({
            productId: i.productId,
            variantId: i.variantId,
            size: i.size,
            qty: i.qty,
          })),
          customerName: form.name,
          customerPhone: form.phone,
          customerEmail: form.email || undefined,
          shippingAddress: { line1: form.line1, city: form.city, state: form.state, pincode: form.pincode },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not create order");

      setPendingOrderId(data.orderId);

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
      <h1 className="font-display text-2xl mb-6">Checkout</h1>

      <div className="flex flex-col gap-3 mb-7">
        {(["name", "phone", "email", "line1", "city", "state", "pincode"] as const).map((field) => (
          <input
            key={field}
            placeholder={field}
            value={form[field]}
            onChange={(e) => setForm({ ...form, [field]: e.target.value })}
            className="px-3.5 py-3 border border-stone bg-card text-[13.5px]"
          />
        ))}
      </div>

      <div className="bg-card border border-stone p-4 mb-6 text-sm">
        <div className="text-[11px] tracking-[0.08em] text-stone-dark mb-2">ORDER SUMMARY</div>
        {items.map((i) => (
          <div key={i.variantId} className="flex justify-between mb-1.5">
            <span>{i.name} × {i.qty}</span>
            <span className="font-mono">{formatINR(i.unitPrice * i.qty)}</span>
          </div>
        ))}
        <div className="flex justify-between font-semibold pt-2 mt-2 border-t border-stone">
          <span>Subtotal</span>
          <span className="font-mono">{formatINR(subtotal)}</span>
        </div>
      </div>

      {error && <p className="text-clay text-[12.5px] mb-4">{error}</p>}

      <button
        onClick={handlePay}
        disabled={loading || items.length === 0}
        className="w-full py-3.5 bg-navy text-white text-[13.5px] tracking-[0.04em] disabled:opacity-50"
      >
        {loading ? "Processing…" : `Pay ${formatINR(subtotal)} with Razorpay`}
      </button>
    </main>
  );
}
