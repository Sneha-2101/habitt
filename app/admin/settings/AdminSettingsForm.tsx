"use client";

import { useState, useTransition } from "react";
import { updateSettings } from "@/lib/settings";

interface SettingsFormProps {
  initialSettings: {
    codEnabled: boolean;
    codOrderCap: number;
    shippingFee: number;
    freeShippingThreshold: number;
    codFeeEnabled: boolean;
    codFee: number;
    gstEnabled: boolean;
    gstRate: number;
    gstin: string | null;
    businessName: string;
    businessTagline: string;
    supportEmail: string;
    orderSenderEmail: string;
    businessAddress: string | null;
    lowStockThreshold: number;
    welcomeCouponCode: string;
    welcomeCouponPercent: number;
    birthdayDiscountPercent: number;
    returnWindowDays: number;
    abandonedCartDelayHours: number;
  };
}

export default function AdminSettingsForm({ initialSettings }: SettingsFormProps) {
  const [form, setForm] = useState({
    codEnabled: initialSettings.codEnabled,
    codOrderCapRupees: Math.round(initialSettings.codOrderCap / 100),
    shippingFeeRupees: Math.round(initialSettings.shippingFee / 100),
    freeShippingThresholdRupees: Math.round(initialSettings.freeShippingThreshold / 100),
    codFeeEnabled: initialSettings.codFeeEnabled,
    codFeeRupees: Math.round(initialSettings.codFee / 100),
    gstEnabled: initialSettings.gstEnabled,
    gstRate: initialSettings.gstRate,
    gstin: initialSettings.gstin || "",
    businessName: initialSettings.businessName,
    businessTagline: initialSettings.businessTagline,
    supportEmail: initialSettings.supportEmail,
    orderSenderEmail: initialSettings.orderSenderEmail,
    businessAddress: initialSettings.businessAddress || "",
    lowStockThreshold: initialSettings.lowStockThreshold,
    welcomeCouponCode: initialSettings.welcomeCouponCode,
    welcomeCouponPercent: initialSettings.welcomeCouponPercent,
    birthdayDiscountPercent: initialSettings.birthdayDiscountPercent,
    returnWindowDays: initialSettings.returnWindowDays,
    abandonedCartDelayHours: initialSettings.abandonedCartDelayHours,
  });

  const [activeTab, setActiveTab] = useState<
    "payments" | "shipping" | "tax" | "contact" | "inventory" | "marketing" | "returns" | "notifications"
  >("payments");

  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);

    startTransition(async () => {
      try {
        await updateSettings({
          codEnabled: form.codEnabled,
          codOrderCap: Math.max(0, Math.round(Number(form.codOrderCapRupees) * 100)),
          shippingFee: Math.max(0, Math.round(Number(form.shippingFeeRupees) * 100)),
          freeShippingThreshold: Math.max(0, Math.round(Number(form.freeShippingThresholdRupees) * 100)),
          codFeeEnabled: form.codFeeEnabled,
          codFee: Math.max(0, Math.round(Number(form.codFeeRupees) * 100)),
          gstEnabled: form.gstEnabled,
          gstRate: Math.max(0, Number(form.gstRate)),
          gstin: form.gstin.trim() || null,
          businessName: form.businessName,
          businessTagline: form.businessTagline,
          supportEmail: form.supportEmail,
          orderSenderEmail: form.orderSenderEmail,
          businessAddress: form.businessAddress.trim() || null,
          lowStockThreshold: Math.max(0, Number(form.lowStockThreshold)),
          welcomeCouponCode: form.welcomeCouponCode,
          welcomeCouponPercent: Math.max(0, Number(form.welcomeCouponPercent)),
          birthdayDiscountPercent: Math.max(0, Number(form.birthdayDiscountPercent)),
          returnWindowDays: Math.max(0, Number(form.returnWindowDays)),
          abandonedCartDelayHours: Math.max(0, Number(form.abandonedCartDelayHours)),
        });
        setMessage({ type: "success", text: "Store settings saved successfully." });
      } catch (err: any) {
        setMessage({ type: "error", text: err?.message || "Failed to update settings." });
      }
    });
  };

  const tabs = [
    { id: "payments", label: "💳 Payments & COD" },
    { id: "shipping", label: "🚚 Shipping" },
    { id: "tax", label: "📄 Tax & Invoice" },
    { id: "contact", label: "✉️ Store Contact" },
    { id: "inventory", label: "📦 Inventory" },
    { id: "marketing", label: "🏷️ Marketing" },
    { id: "returns", label: "↩️ Returns" },
    { id: "notifications", label: "⏱️ Notifications" },
  ] as const;

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-3xl">
      {message && (
        <div
          className={`p-3 text-xs border rounded-sm ${
            message.type === "success"
              ? "bg-emerald-50 border-emerald-200 text-emerald-800 font-medium"
              : "bg-red-50 border-red-200 text-red-800 font-medium"
          }`}
        >
          {message.text}
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="flex gap-2 flex-wrap border-b border-stone pb-3">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setActiveTab(t.id)}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-xs transition-colors ${
              activeTab === t.id
                ? "bg-ink text-white"
                : "bg-white text-stone-dark border border-stone hover:bg-paper"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab Panels */}
      <div className="border border-stone bg-white p-6 rounded-sm space-y-6">
        {/* Payments & COD */}
        {activeTab === "payments" && (
          <div className="space-y-5">
            <div>
              <h2 className="text-sm font-semibold text-ink mb-1">Cash on Delivery (COD) Settings</h2>
              <p className="text-xs text-stone-dark">Configure availability, order limits, and optional surcharge fees for COD.</p>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <input
                type="checkbox"
                id="codEnabled"
                checked={form.codEnabled}
                onChange={(e) => setForm({ ...form, codEnabled: e.target.checked })}
                className="w-4 h-4 accent-ink cursor-pointer"
              />
              <label htmlFor="codEnabled" className="text-xs font-medium text-ink cursor-pointer">
                Enable Cash on Delivery (COD) payment option
              </label>
            </div>

            <div>
              <label htmlFor="codOrderCap" className="block text-xs font-medium text-ink mb-1">
                COD Order Value Cap (₹)
              </label>
              <p className="text-[11px] text-stone-dark mb-2">Orders above this subtotal must be paid online via Razorpay.</p>
              <div className="relative max-w-xs">
                <span className="absolute left-3 top-2.5 text-xs text-stone-dark">₹</span>
                <input
                  type="number"
                  id="codOrderCap"
                  min="0"
                  step="100"
                  value={form.codOrderCapRupees}
                  onChange={(e) => setForm({ ...form, codOrderCapRupees: Number(e.target.value) })}
                  className="w-full pl-7 pr-3 py-2 border border-stone text-xs rounded-sm focus:outline-none focus:border-ink bg-paper"
                  required
                />
              </div>
            </div>

            <div className="pt-3 border-t border-stone/50 space-y-3">
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="codFeeEnabled"
                  checked={form.codFeeEnabled}
                  onChange={(e) => setForm({ ...form, codFeeEnabled: e.target.checked })}
                  className="w-4 h-4 accent-ink cursor-pointer"
                />
                <label htmlFor="codFeeEnabled" className="text-xs font-medium text-ink cursor-pointer">
                  Charge extra handling / convenience fee for COD orders
                </label>
              </div>

              {form.codFeeEnabled && (
                <div>
                  <label htmlFor="codFee" className="block text-xs font-medium text-ink mb-1">
                    COD Handling Fee Amount (₹)
                  </label>
                  <div className="relative max-w-xs">
                    <span className="absolute left-3 top-2.5 text-xs text-stone-dark">₹</span>
                    <input
                      type="number"
                      id="codFee"
                      min="0"
                      step="10"
                      value={form.codFeeRupees}
                      onChange={(e) => setForm({ ...form, codFeeRupees: Number(e.target.value) })}
                      className="w-full pl-7 pr-3 py-2 border border-stone text-xs rounded-sm focus:outline-none focus:border-ink bg-paper"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Shipping & Delivery */}
        {activeTab === "shipping" && (
          <div className="space-y-5">
            <div>
              <h2 className="text-sm font-semibold text-ink mb-1">Shipping & Delivery Rates</h2>
              <p className="text-xs text-stone-dark">Set standard flat shipping fee and free shipping eligibility threshold.</p>
            </div>

            <div>
              <label htmlFor="shippingFee" className="block text-xs font-medium text-ink mb-1">
                Standard Flat Shipping Fee (₹)
              </label>
              <div className="relative max-w-xs">
                <span className="absolute left-3 top-2.5 text-xs text-stone-dark">₹</span>
                <input
                  type="number"
                  id="shippingFee"
                  min="0"
                  step="10"
                  value={form.shippingFeeRupees}
                  onChange={(e) => setForm({ ...form, shippingFeeRupees: Number(e.target.value) })}
                  className="w-full pl-7 pr-3 py-2 border border-stone text-xs rounded-sm focus:outline-none focus:border-ink bg-paper"
                  required
                />
              </div>
            </div>

            <div>
              <label htmlFor="freeShippingThreshold" className="block text-xs font-medium text-ink mb-1">
                Free Shipping Subtotal Threshold (₹)
              </label>
              <p className="text-[11px] text-stone-dark mb-2">Orders with subtotal at or above this amount receive free shipping.</p>
              <div className="relative max-w-xs">
                <span className="absolute left-3 top-2.5 text-xs text-stone-dark">₹</span>
                <input
                  type="number"
                  id="freeShippingThreshold"
                  min="0"
                  step="100"
                  value={form.freeShippingThresholdRupees}
                  onChange={(e) => setForm({ ...form, freeShippingThresholdRupees: Number(e.target.value) })}
                  className="w-full pl-7 pr-3 py-2 border border-stone text-xs rounded-sm focus:outline-none focus:border-ink bg-paper"
                  required
                />
              </div>
            </div>
          </div>
        )}

        {/* Tax & Invoicing */}
        {activeTab === "tax" && (
          <div className="space-y-5">
            <div>
              <h2 className="text-sm font-semibold text-ink mb-1">GST & Tax Invoice Settings</h2>
              <p className="text-xs text-stone-dark">Configure business details and GST tax rates printed on PDF invoices.</p>
            </div>

            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="gstEnabled"
                checked={form.gstEnabled}
                onChange={(e) => setForm({ ...form, gstEnabled: e.target.checked })}
                className="w-4 h-4 accent-ink cursor-pointer"
              />
              <label htmlFor="gstEnabled" className="text-xs font-medium text-ink cursor-pointer">
                Enable GST tax calculations & GSTIN on customer invoices
              </label>
            </div>

            {form.gstEnabled && (
              <div className="grid grid-cols-2 gap-4 pt-2">
                <div>
                  <label htmlFor="gstRate" className="block text-xs font-medium text-ink mb-1">
                    GST Rate (%)
                  </label>
                  <input
                    type="number"
                    id="gstRate"
                    step="0.1"
                    min="0"
                    max="28"
                    value={form.gstRate}
                    onChange={(e) => setForm({ ...form, gstRate: Number(e.target.value) })}
                    className="w-full px-3 py-2 border border-stone text-xs rounded-sm focus:outline-none focus:border-ink bg-paper"
                  />
                </div>
                <div>
                  <label htmlFor="gstin" className="block text-xs font-medium text-ink mb-1">
                    Business GSTIN Number
                  </label>
                  <input
                    type="text"
                    id="gstin"
                    placeholder="e.g. 27AAAAA0000A1Z5"
                    value={form.gstin}
                    onChange={(e) => setForm({ ...form, gstin: e.target.value })}
                    className="w-full px-3 py-2 border border-stone text-xs rounded-sm uppercase focus:outline-none focus:border-ink bg-paper"
                  />
                </div>
              </div>
            )}

            <div className="pt-3 border-t border-stone/50 space-y-4">
              <h3 className="text-xs font-semibold text-ink uppercase tracking-wider">Business Invoice Info</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="businessName" className="block text-xs font-medium text-ink mb-1">Store / Business Name</label>
                  <input
                    type="text"
                    id="businessName"
                    value={form.businessName}
                    onChange={(e) => setForm({ ...form, businessName: e.target.value })}
                    className="w-full px-3 py-2 border border-stone text-xs rounded-sm focus:outline-none focus:border-ink bg-paper"
                    required
                  />
                </div>
                <div>
                  <label htmlFor="businessTagline" className="block text-xs font-medium text-ink mb-1">Brand Tagline</label>
                  <input
                    type="text"
                    id="businessTagline"
                    value={form.businessTagline}
                    onChange={(e) => setForm({ ...form, businessTagline: e.target.value })}
                    className="w-full px-3 py-2 border border-stone text-xs rounded-sm focus:outline-none focus:border-ink bg-paper"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="businessAddress" className="block text-xs font-medium text-ink mb-1">Registered Business Address</label>
                <textarea
                  id="businessAddress"
                  rows={2}
                  placeholder="e.g. 102 Craft House, MG Road, Mumbai, Maharashtra 400001"
                  value={form.businessAddress}
                  onChange={(e) => setForm({ ...form, businessAddress: e.target.value })}
                  className="w-full px-3 py-2 border border-stone text-xs rounded-sm focus:outline-none focus:border-ink bg-paper"
                />
              </div>
            </div>
          </div>
        )}

        {/* Store Contact */}
        {activeTab === "contact" && (
          <div className="space-y-5">
            <div>
              <h2 className="text-sm font-semibold text-ink mb-1">Store Contact Emails</h2>
              <p className="text-xs text-stone-dark">Emails used for customer support and transactional notifications.</p>
            </div>

            <div>
              <label htmlFor="supportEmail" className="block text-xs font-medium text-ink mb-1">
                Customer Support Email
              </label>
              <input
                type="email"
                id="supportEmail"
                value={form.supportEmail}
                onChange={(e) => setForm({ ...form, supportEmail: e.target.value })}
                className="w-full max-w-md px-3 py-2 border border-stone text-xs rounded-sm focus:outline-none focus:border-ink bg-paper"
                required
              />
            </div>

            <div>
              <label htmlFor="orderSenderEmail" className="block text-xs font-medium text-ink mb-1">
                Order Sender Email (From Address)
              </label>
              <input
                type="email"
                id="orderSenderEmail"
                value={form.orderSenderEmail}
                onChange={(e) => setForm({ ...form, orderSenderEmail: e.target.value })}
                className="w-full max-w-md px-3 py-2 border border-stone text-xs rounded-sm focus:outline-none focus:border-ink bg-paper"
                required
              />
            </div>
          </div>
        )}

        {/* Inventory */}
        {activeTab === "inventory" && (
          <div className="space-y-5">
            <div>
              <h2 className="text-sm font-semibold text-ink mb-1">Inventory & Stock Alerts</h2>
              <p className="text-xs text-stone-dark">Set unified threshold for low-stock badges and admin alerts.</p>
            </div>

            <div>
              <label htmlFor="lowStockThreshold" className="block text-xs font-medium text-ink mb-1">
                Low Stock Threshold (Units)
              </label>
              <p className="text-[11px] text-stone-dark mb-2">
                Variants with stock $\le$ this number trigger customer "Only X left" badges and admin warnings.
              </p>
              <input
                type="number"
                id="lowStockThreshold"
                min="0"
                max="50"
                value={form.lowStockThreshold}
                onChange={(e) => setForm({ ...form, lowStockThreshold: Number(e.target.value) })}
                className="w-full max-w-xs px-3 py-2 border border-stone text-xs rounded-sm focus:outline-none focus:border-ink bg-paper"
                required
              />
            </div>
          </div>
        )}

        {/* Marketing */}
        {activeTab === "marketing" && (
          <div className="space-y-5">
            <div>
              <h2 className="text-sm font-semibold text-ink mb-1">Newsletter & Welcome Coupon</h2>
              <p className="text-xs text-stone-dark">Configure coupon code issued to new email newsletter subscribers.</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="welcomeCouponCode" className="block text-xs font-medium text-ink mb-1">
                  Welcome Coupon Code
                </label>
                <input
                  type="text"
                  id="welcomeCouponCode"
                  value={form.welcomeCouponCode}
                  onChange={(e) => setForm({ ...form, welcomeCouponCode: e.target.value })}
                  className="w-full px-3 py-2 border border-stone text-xs uppercase font-mono rounded-sm focus:outline-none focus:border-ink bg-paper"
                  required
                />
              </div>

              <div>
                <label htmlFor="welcomeCouponPercent" className="block text-xs font-medium text-ink mb-1">
                  Discount Percentage (%)
                </label>
                <input
                  type="number"
                  id="welcomeCouponPercent"
                  min="1"
                  max="100"
                  value={form.welcomeCouponPercent}
                  onChange={(e) => setForm({ ...form, welcomeCouponPercent: Number(e.target.value) })}
                  className="w-full px-3 py-2 border border-stone text-xs rounded-sm focus:outline-none focus:border-ink bg-paper"
                  required
                />
              </div>
            </div>

            <div className="pt-3 border-t border-stone/50">
              <label htmlFor="birthdayDiscountPercent" className="block text-xs font-medium text-ink mb-1">
                Birthday Discount Coupon Percentage (%)
              </label>
              <p className="text-[11px] text-stone-dark mb-2">
                Unique single-use coupon generated for users on their birthday (valid for 30 days).
              </p>
              <input
                type="number"
                id="birthdayDiscountPercent"
                min="1"
                max="100"
                value={form.birthdayDiscountPercent}
                onChange={(e) => setForm({ ...form, birthdayDiscountPercent: Number(e.target.value) })}
                className="w-full max-w-xs px-3 py-2 border border-stone text-xs rounded-sm focus:outline-none focus:border-ink bg-paper"
                required
              />
            </div>
          </div>
        )}

        {/* Returns */}
        {activeTab === "returns" && (
          <div className="space-y-5">
            <div>
              <h2 className="text-sm font-semibold text-ink mb-1">Returns & Refund Window</h2>
              <p className="text-xs text-stone-dark">Define the post-delivery return request window enforced server-side.</p>
            </div>

            <div>
              <label htmlFor="returnWindowDays" className="block text-xs font-medium text-ink mb-1">
                Return Eligibility Window (Days post-delivery)
              </label>
              <p className="text-[11px] text-stone-dark mb-2">
                Return requests after this number of days from delivery are automatically rejected.
              </p>
              <input
                type="number"
                id="returnWindowDays"
                min="1"
                max="90"
                value={form.returnWindowDays}
                onChange={(e) => setForm({ ...form, returnWindowDays: Number(e.target.value) })}
                className="w-full max-w-xs px-3 py-2 border border-stone text-xs rounded-sm focus:outline-none focus:border-ink bg-paper"
                required
              />
            </div>
          </div>
        )}

        {/* Notifications */}
        {activeTab === "notifications" && (
          <div className="space-y-5">
            <div>
              <h2 className="text-sm font-semibold text-ink mb-1">Automated Abandoned Cart Timing</h2>
              <p className="text-xs text-stone-dark">Set how long a pending order remains untouched before reminder email is sent.</p>
            </div>

            <div>
              <label htmlFor="abandonedCartDelayHours" className="block text-xs font-medium text-ink mb-1">
                Abandoned Cart Delay (Hours)
              </label>
              <p className="text-[11px] text-stone-dark mb-2">
                The cron job selects pending orders created $\ge$ this many hours ago for email reminders.
              </p>
              <input
                type="number"
                id="abandonedCartDelayHours"
                min="1"
                max="168"
                value={form.abandonedCartDelayHours}
                onChange={(e) => setForm({ ...form, abandonedCartDelayHours: Number(e.target.value) })}
                className="w-full max-w-xs px-3 py-2 border border-stone text-xs rounded-sm focus:outline-none focus:border-ink bg-paper"
                required
              />
            </div>
          </div>
        )}
      </div>

      <div className="pt-2">
        <button
          type="submit"
          disabled={isPending}
          className="px-6 py-2.5 bg-ink text-white text-xs font-medium tracking-[0.04em] rounded-sm hover:bg-opacity-90 disabled:opacity-50 transition-opacity"
        >
          {isPending ? "SAVING SETTINGS..." : "SAVE ALL STORE SETTINGS"}
        </button>
      </div>
    </form>
  );
}
