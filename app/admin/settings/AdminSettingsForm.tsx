"use client";

import { useState, useTransition } from "react";
import { updateSettings, uploadOgDefaultImageAction } from "@/lib/actions/settings";

interface SettingsFormProps {
  isOwner?: boolean;
  seoStatus?: { allowed: boolean; blockedReason: string | null };
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
    freeShippingOnPrepaid: boolean;
    codRequiresDeliveredOrder: boolean;
    freeReturnShipping: boolean;
    refundProcessingHours: number;
    maxDeliveryDays: number;
    legalName: string | null;
    businessPhone: string | null;
    businessState: string | null;
    businessPincode: string | null;
    whatsappSupportNumber: string | null;
    shiprocketPickupLocation: string;
    grievanceOfficerName?: string | null;
    grievanceOfficerEmail?: string | null;
    grievanceOfficerPhone?: string | null;
    grievanceOfficerAddress?: string | null;
    businessAddressLine1?: string | null;
    businessAddressLine2?: string | null;
    businessCity?: string | null;
    pickupAddressLine1?: string | null;
    pickupAddressLine2?: string | null;
    pickupCity?: string | null;
    pickupPincode?: string | null;
    pickupPhone?: string | null;
    ordersEmail?: string | null;
    replyToEmail?: string | null;
    dispatchHandlingNote?: string | null;
    instagramUrl?: string | null;
    facebookUrl?: string | null;
    seoIndexingEnabled?: boolean;
    googleSiteVerification?: string | null;
    ogDefaultImageUrl?: string | null;
  };
}

export default function AdminSettingsForm({
  isOwner = false,
  seoStatus,
  initialSettings,
}: SettingsFormProps) {
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
    freeShippingOnPrepaid: initialSettings.freeShippingOnPrepaid,
    codRequiresDeliveredOrder: initialSettings.codRequiresDeliveredOrder,
    freeReturnShipping: initialSettings.freeReturnShipping,
    refundProcessingHours: initialSettings.refundProcessingHours,
    maxDeliveryDays: initialSettings.maxDeliveryDays,
    legalName: initialSettings.legalName || "",
    businessPhone: initialSettings.businessPhone || "",
    businessState: initialSettings.businessState || "",
    businessPincode: initialSettings.businessPincode || "",
    whatsappSupportNumber: initialSettings.whatsappSupportNumber || "",
    shiprocketPickupLocation: initialSettings.shiprocketPickupLocation || "Primary",
    grievanceOfficerName: initialSettings.grievanceOfficerName || "",
    grievanceOfficerEmail: initialSettings.grievanceOfficerEmail || "",
    grievanceOfficerPhone: initialSettings.grievanceOfficerPhone || "",
    grievanceOfficerAddress: initialSettings.grievanceOfficerAddress || "",
    businessAddressLine1: initialSettings.businessAddressLine1 || "",
    businessAddressLine2: initialSettings.businessAddressLine2 || "",
    businessCity: initialSettings.businessCity || "",
    pickupAddressLine1: initialSettings.pickupAddressLine1 || "",
    pickupAddressLine2: initialSettings.pickupAddressLine2 || "",
    pickupCity: initialSettings.pickupCity || "",
    pickupPincode: initialSettings.pickupPincode || "",
    pickupPhone: initialSettings.pickupPhone || "",
    ordersEmail: initialSettings.ordersEmail || "",
    replyToEmail: initialSettings.replyToEmail || "",
    dispatchHandlingNote: initialSettings.dispatchHandlingNote || "",
    instagramUrl: initialSettings.instagramUrl || "",
    facebookUrl: initialSettings.facebookUrl || "",
    seoIndexingEnabled: initialSettings.seoIndexingEnabled ?? false,
    googleSiteVerification: initialSettings.googleSiteVerification || "",
    ogDefaultImageUrl: initialSettings.ogDefaultImageUrl || "",
  });

  const [activeTab, setActiveTab] = useState<
    "payments" | "shipping" | "tax" | "contact" | "inventory" | "marketing" | "returns" | "notifications" | "seo"
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
          freeShippingOnPrepaid: form.freeShippingOnPrepaid,
          codRequiresDeliveredOrder: form.codRequiresDeliveredOrder,
          freeReturnShipping: form.freeReturnShipping,
          refundProcessingHours: Math.max(1, Math.min(240, Number(form.refundProcessingHours))),
          maxDeliveryDays: Math.max(1, Math.min(60, Number(form.maxDeliveryDays))),
          legalName: form.legalName.trim() || null,
          businessPhone: form.businessPhone.trim() || null,
          businessState: form.businessState.trim() || null,
          businessPincode: form.businessPincode.trim() || null,
          whatsappSupportNumber: form.whatsappSupportNumber.trim() || null,
          shiprocketPickupLocation: form.shiprocketPickupLocation.trim() || "Primary",
          grievanceOfficerName: form.grievanceOfficerName.trim() || null,
          grievanceOfficerEmail: form.grievanceOfficerEmail.trim() || null,
          grievanceOfficerPhone: form.grievanceOfficerPhone.trim() || null,
          grievanceOfficerAddress: form.grievanceOfficerAddress.trim() || null,
          businessAddressLine1: form.businessAddressLine1.trim() || null,
          businessAddressLine2: form.businessAddressLine2.trim() || null,
          businessCity: form.businessCity.trim() || null,
          pickupAddressLine1: form.pickupAddressLine1.trim() || null,
          pickupAddressLine2: form.pickupAddressLine2.trim() || null,
          pickupCity: form.pickupCity.trim() || null,
          pickupPincode: form.pickupPincode.trim() || null,
          pickupPhone: form.pickupPhone.trim() || null,
          ordersEmail: form.ordersEmail.trim() || null,
          replyToEmail: form.replyToEmail.trim() || null,
          dispatchHandlingNote: form.dispatchHandlingNote.trim() || null,
          instagramUrl: form.instagramUrl.trim() || null,
          facebookUrl: form.facebookUrl.trim() || null,
          ...(isOwner ? { seoIndexingEnabled: form.seoIndexingEnabled } : {}),
          googleSiteVerification: form.googleSiteVerification.trim() || null,
          ogDefaultImageUrl: form.ogDefaultImageUrl.trim() || null,
        });
        setMessage({ type: "success", text: "Store settings saved successfully." });
      } catch (err: unknown) {
        setMessage({ type: "error", text: err instanceof Error ? err.message : "Failed to update settings." });
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
    { id: "seo", label: "🔍 SEO" },
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
              <p className="text-xs text-stone-dark">Configure availability, order limits, customer verification, and optional surcharge fees for COD.</p>
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

            <div className="flex items-center gap-3 pt-1">
              <input
                type="checkbox"
                id="codRequiresDeliveredOrder"
                checked={form.codRequiresDeliveredOrder}
                onChange={(e) => setForm({ ...form, codRequiresDeliveredOrder: e.target.checked })}
                className="w-4 h-4 accent-ink cursor-pointer"
              />
              <div>
                <label htmlFor="codRequiresDeliveredOrder" className="text-xs font-medium text-ink cursor-pointer">
                  Require at least one delivered order for COD eligibility
                </label>
                <p className="text-[11px] text-stone-dark">When enabled, first-time customers must prepay online to establish account trust.</p>
              </div>
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
              <p className="text-xs text-stone-dark">Set standard flat shipping fee, free shipping eligibility, delivery turnaround, and Shiprocket integration.</p>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <input
                type="checkbox"
                id="freeShippingOnPrepaid"
                checked={form.freeShippingOnPrepaid}
                onChange={(e) => setForm({ ...form, freeShippingOnPrepaid: e.target.checked })}
                className="w-4 h-4 accent-ink cursor-pointer"
              />
              <div>
                <label htmlFor="freeShippingOnPrepaid" className="text-xs font-medium text-ink cursor-pointer">
                  Free shipping on all prepaid orders (Razorpay & Store Credit)
                </label>
                <p className="text-[11px] text-stone-dark">When enabled, customers paying online enjoy zero delivery fees regardless of order amount.</p>
              </div>
            </div>

            <div>
              <label htmlFor="shippingFee" className="block text-xs font-medium text-ink mb-1">
                Standard Flat Shipping Fee (₹)
              </label>
              <p className="text-[11px] text-stone-dark mb-2">Default delivery charge applied when free shipping rules are not satisfied.</p>
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
              <p className="text-[11px] text-stone-dark mb-2">Orders with subtotal at or above this amount receive free delivery.</p>
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

            <div>
              <label htmlFor="maxDeliveryDays" className="block text-xs font-medium text-ink mb-1">
                Maximum Estimated Delivery Days
              </label>
              <p className="text-[11px] text-stone-dark mb-2">Estimated delivery timeframe displayed on product details and shipping policy pages (1 to 60 days).</p>
              <input
                type="number"
                id="maxDeliveryDays"
                min="1"
                max="60"
                value={form.maxDeliveryDays}
                onChange={(e) => setForm({ ...form, maxDeliveryDays: Number(e.target.value) })}
                className="w-full max-w-xs px-3 py-2 border border-stone text-xs rounded-sm focus:outline-none focus:border-ink bg-paper"
                required
              />
            </div>

            <div>
              <label htmlFor="shiprocketPickupLocation" className="block text-xs font-medium text-ink mb-1">
                Shiprocket Pickup Location
              </label>
              <p className="text-[11px] text-stone-dark mb-2">Configured warehouse pickup location nickname in your Shiprocket account.</p>
              <input
                type="text"
                id="shiprocketPickupLocation"
                value={form.shiprocketPickupLocation}
                onChange={(e) => setForm({ ...form, shiprocketPickupLocation: e.target.value })}
                className="w-full max-w-md px-3 py-2 border border-stone text-xs rounded-sm focus:outline-none focus:border-ink bg-paper"
                required
              />
            </div>

            <div>
              <label htmlFor="dispatchHandlingNote" className="block text-xs font-medium text-ink mb-1">
                Dispatch Handling Note (Optional)
              </label>
              <p className="text-[11px] text-stone-dark mb-2">Optional note shown on shipping policy & support pages only when set.</p>
              <input
                type="text"
                id="dispatchHandlingNote"
                placeholder="e.g. Orders placed before 2 PM IST ship the next working day"
                value={form.dispatchHandlingNote}
                onChange={(e) => setForm({ ...form, dispatchHandlingNote: e.target.value })}
                className="w-full max-w-lg px-3 py-2 border border-stone text-xs rounded-sm focus:outline-none focus:border-ink bg-paper"
              />
            </div>

            <div className="pt-4 border-t border-stone/50 space-y-4">
              <div>
                <h3 className="text-xs font-semibold text-ink uppercase tracking-wider">Warehouse Pickup Address</h3>
                <p className="text-[11px] text-stone-dark">Physical pickup origin used for courier manifests and return pickups.</p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="pickupAddressLine1" className="block text-xs font-medium text-ink mb-1">Pickup Address Line 1</label>
                  <input
                    type="text"
                    id="pickupAddressLine1"
                    value={form.pickupAddressLine1}
                    onChange={(e) => setForm({ ...form, pickupAddressLine1: e.target.value })}
                    className="w-full px-3 py-2 border border-stone text-xs rounded-sm focus:outline-none focus:border-ink bg-paper"
                  />
                </div>
                <div>
                  <label htmlFor="pickupAddressLine2" className="block text-xs font-medium text-ink mb-1">Pickup Address Line 2</label>
                  <input
                    type="text"
                    id="pickupAddressLine2"
                    value={form.pickupAddressLine2}
                    onChange={(e) => setForm({ ...form, pickupAddressLine2: e.target.value })}
                    className="w-full px-3 py-2 border border-stone text-xs rounded-sm focus:outline-none focus:border-ink bg-paper"
                  />
                </div>
                <div>
                  <label htmlFor="pickupCity" className="block text-xs font-medium text-ink mb-1">Pickup City</label>
                  <input
                    type="text"
                    id="pickupCity"
                    value={form.pickupCity}
                    onChange={(e) => setForm({ ...form, pickupCity: e.target.value })}
                    className="w-full px-3 py-2 border border-stone text-xs rounded-sm focus:outline-none focus:border-ink bg-paper"
                  />
                </div>
                <div>
                  <label htmlFor="pickupPincode" className="block text-xs font-medium text-ink mb-1">Pickup Pincode</label>
                  <input
                    type="text"
                    id="pickupPincode"
                    placeholder="6-digit pincode"
                    value={form.pickupPincode}
                    onChange={(e) => setForm({ ...form, pickupPincode: e.target.value })}
                    className="w-full px-3 py-2 border border-stone text-xs rounded-sm focus:outline-none focus:border-ink bg-paper"
                  />
                </div>
                <div>
                  <label htmlFor="pickupPhone" className="block text-xs font-medium text-ink mb-1">Pickup Contact Phone</label>
                  <input
                    type="tel"
                    id="pickupPhone"
                    placeholder="10-digit mobile number"
                    value={form.pickupPhone}
                    onChange={(e) => setForm({ ...form, pickupPhone: e.target.value })}
                    className="w-full px-3 py-2 border border-stone text-xs rounded-sm focus:outline-none focus:border-ink bg-paper"
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tax & Invoicing */}
        {activeTab === "tax" && (
          <div className="space-y-5">
            <div>
              <h2 className="text-sm font-semibold text-ink mb-1">GST & Tax Invoice Settings</h2>
              <p className="text-xs text-stone-dark">Configure business legal entity details and GST tax rates printed on customer invoices.</p>
            </div>

            <div>
              <label htmlFor="legalName" className="block text-xs font-medium text-ink mb-1">
                Legal Entity Name
              </label>
              <p className="text-[11px] text-stone-dark mb-2">Official registered legal name printed on tax receipts and footer notices (falls back to Business Name if empty).</p>
              <input
                type="text"
                id="legalName"
                placeholder="e.g. Habitt Apparel Private Limited"
                value={form.legalName}
                onChange={(e) => setForm({ ...form, legalName: e.target.value })}
                className="w-full max-w-md px-3 py-2 border border-stone text-xs rounded-sm focus:outline-none focus:border-ink bg-paper"
              />
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
              <h3 className="text-xs font-semibold text-ink uppercase tracking-wider">Business Display Info</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="businessName" className="block text-xs font-medium text-ink mb-1">Store / Brand Name</label>
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
                  placeholder="e.g. 102 Craft House, MG Road, Mumbai"
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
              <h2 className="text-sm font-semibold text-ink mb-1">Store Contact & Channels</h2>
              <p className="text-xs text-stone-dark">Manage official emails, phone lines, state, pincode, and customer WhatsApp support widget.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="supportEmail" className="block text-xs font-medium text-ink mb-1">
                  Customer Support Email (Reply-To)
                </label>
                <p className="text-[11px] text-stone-dark mb-1">Used as Reply-To on all order emails and support links.</p>
                <input
                  type="email"
                  id="supportEmail"
                  value={form.supportEmail}
                  onChange={(e) => setForm({ ...form, supportEmail: e.target.value })}
                  className="w-full px-3 py-2 border border-stone text-xs rounded-sm focus:outline-none focus:border-ink bg-paper"
                  required
                />
              </div>

              <div>
                <label htmlFor="orderSenderEmail" className="block text-xs font-medium text-ink mb-1">
                  Order Sender Email (From Address)
                </label>
                <p className="text-[11px] text-stone-dark mb-1">Verified sender email used in transactional order dispatches.</p>
                <input
                  type="email"
                  id="orderSenderEmail"
                  value={form.orderSenderEmail}
                  onChange={(e) => setForm({ ...form, orderSenderEmail: e.target.value })}
                  className="w-full px-3 py-2 border border-stone text-xs rounded-sm focus:outline-none focus:border-ink bg-paper"
                  required
                />
              </div>

              <div>
                <label htmlFor="businessPhone" className="block text-xs font-medium text-ink mb-1">
                  Business Phone Number
                </label>
                <p className="text-[11px] text-stone-dark mb-1">10-digit Indian mobile number for customer inquiries (omits row if empty).</p>
                <input
                  type="tel"
                  id="businessPhone"
                  placeholder="10-digit mobile number"
                  value={form.businessPhone}
                  onChange={(e) => setForm({ ...form, businessPhone: e.target.value })}
                  className="w-full px-3 py-2 border border-stone text-xs rounded-sm focus:outline-none focus:border-ink bg-paper"
                />
              </div>

              <div>
                <label htmlFor="whatsappSupportNumber" className="block text-xs font-medium text-ink mb-1">
                  WhatsApp Support Number
                </label>
                <p className="text-[11px] text-stone-dark mb-1">10-digit Indian mobile number powering the chat widget (widget hidden if empty).</p>
                <input
                  type="tel"
                  id="whatsappSupportNumber"
                  placeholder="10-digit mobile number"
                  value={form.whatsappSupportNumber}
                  onChange={(e) => setForm({ ...form, whatsappSupportNumber: e.target.value })}
                  className="w-full px-3 py-2 border border-stone text-xs rounded-sm focus:outline-none focus:border-ink bg-paper"
                />
              </div>

              <div>
                <label htmlFor="businessState" className="block text-xs font-medium text-ink mb-1">
                  Business State
                </label>
                <p className="text-[11px] text-stone-dark mb-1">State name used on invoice footers and contact pages.</p>
                <input
                  type="text"
                  id="businessState"
                  placeholder="e.g. Maharashtra"
                  value={form.businessState}
                  onChange={(e) => setForm({ ...form, businessState: e.target.value })}
                  className="w-full px-3 py-2 border border-stone text-xs rounded-sm focus:outline-none focus:border-ink bg-paper"
                />
              </div>

              <div>
                <label htmlFor="businessPincode" className="block text-xs font-medium text-ink mb-1">
                  Business Pincode
                </label>
                <p className="text-[11px] text-stone-dark mb-1">6-digit Indian postal code of registered facility.</p>
                <input
                  type="text"
                  id="businessPincode"
                  placeholder="e.g. 400001"
                  value={form.businessPincode}
                  onChange={(e) => setForm({ ...form, businessPincode: e.target.value })}
                  className="w-full px-3 py-2 border border-stone text-xs rounded-sm focus:outline-none focus:border-ink bg-paper"
                />
              </div>

              <div>
                <label htmlFor="businessAddressLine1" className="block text-xs font-medium text-ink mb-1">
                  Business Address Line 1
                </label>
                <input
                  type="text"
                  id="businessAddressLine1"
                  value={form.businessAddressLine1}
                  onChange={(e) => setForm({ ...form, businessAddressLine1: e.target.value })}
                  className="w-full px-3 py-2 border border-stone text-xs rounded-sm focus:outline-none focus:border-ink bg-paper"
                />
              </div>

              <div>
                <label htmlFor="businessAddressLine2" className="block text-xs font-medium text-ink mb-1">
                  Business Address Line 2
                </label>
                <input
                  type="text"
                  id="businessAddressLine2"
                  value={form.businessAddressLine2}
                  onChange={(e) => setForm({ ...form, businessAddressLine2: e.target.value })}
                  className="w-full px-3 py-2 border border-stone text-xs rounded-sm focus:outline-none focus:border-ink bg-paper"
                />
              </div>

              <div>
                <label htmlFor="businessCity" className="block text-xs font-medium text-ink mb-1">
                  Business City
                </label>
                <input
                  type="text"
                  id="businessCity"
                  value={form.businessCity}
                  onChange={(e) => setForm({ ...form, businessCity: e.target.value })}
                  className="w-full px-3 py-2 border border-stone text-xs rounded-sm focus:outline-none focus:border-ink bg-paper"
                />
              </div>

              <div>
                <label htmlFor="ordersEmail" className="block text-xs font-medium text-ink mb-1">
                  Orders Display Email
                </label>
                <input
                  type="email"
                  id="ordersEmail"
                  value={form.ordersEmail}
                  onChange={(e) => setForm({ ...form, ordersEmail: e.target.value })}
                  className="w-full px-3 py-2 border border-stone text-xs rounded-sm focus:outline-none focus:border-ink bg-paper"
                />
              </div>

              <div>
                <label htmlFor="replyToEmail" className="block text-xs font-medium text-ink mb-1">
                  Reply-To Email
                </label>
                <input
                  type="email"
                  id="replyToEmail"
                  value={form.replyToEmail}
                  onChange={(e) => setForm({ ...form, replyToEmail: e.target.value })}
                  className="w-full px-3 py-2 border border-stone text-xs rounded-sm focus:outline-none focus:border-ink bg-paper"
                />
              </div>

              <div>
                <label htmlFor="instagramUrl" className="block text-xs font-medium text-ink mb-1">
                  Instagram URL (https://)
                </label>
                <input
                  type="url"
                  id="instagramUrl"
                  placeholder="https://instagram.com/..."
                  value={form.instagramUrl}
                  onChange={(e) => setForm({ ...form, instagramUrl: e.target.value })}
                  className="w-full px-3 py-2 border border-stone text-xs rounded-sm focus:outline-none focus:border-ink bg-paper"
                />
              </div>

              <div>
                <label htmlFor="facebookUrl" className="block text-xs font-medium text-ink mb-1">
                  Facebook URL (https://)
                </label>
                <input
                  type="url"
                  id="facebookUrl"
                  placeholder="https://facebook.com/..."
                  value={form.facebookUrl}
                  onChange={(e) => setForm({ ...form, facebookUrl: e.target.value })}
                  className="w-full px-3 py-2 border border-stone text-xs rounded-sm focus:outline-none focus:border-ink bg-paper"
                />
              </div>
            </div>

            <div className="pt-4 border-t border-stone/50 space-y-4">
              <div>
                <h3 className="text-xs font-semibold text-ink uppercase tracking-wider">Grievance Officer (Statutory Compliance)</h3>
                <p className="text-[11px] text-stone-dark">Designated official under IT and Consumer Protection Rules for grievance redressal.</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="grievanceOfficerName" className="block text-xs font-medium text-ink mb-1">
                    Grievance Officer Name
                  </label>
                  <input
                    type="text"
                    id="grievanceOfficerName"
                    placeholder="Full legal name of officer"
                    value={form.grievanceOfficerName}
                    onChange={(e) => setForm({ ...form, grievanceOfficerName: e.target.value })}
                    className="w-full px-3 py-2 border border-stone text-xs rounded-sm focus:outline-none focus:border-ink bg-paper"
                  />
                </div>

                <div>
                  <label htmlFor="grievanceOfficerEmail" className="block text-xs font-medium text-ink mb-1">
                    Grievance Officer Email
                  </label>
                  <input
                    type="email"
                    id="grievanceOfficerEmail"
                    placeholder="e.g. grievance@domain.com"
                    value={form.grievanceOfficerEmail}
                    onChange={(e) => setForm({ ...form, grievanceOfficerEmail: e.target.value })}
                    className="w-full px-3 py-2 border border-stone text-xs rounded-sm focus:outline-none focus:border-ink bg-paper"
                  />
                </div>

                <div>
                  <label htmlFor="grievanceOfficerPhone" className="block text-xs font-medium text-ink mb-1">
                    Grievance Officer Phone
                  </label>
                  <input
                    type="tel"
                    id="grievanceOfficerPhone"
                    placeholder="10-digit mobile number"
                    value={form.grievanceOfficerPhone}
                    onChange={(e) => setForm({ ...form, grievanceOfficerPhone: e.target.value })}
                    className="w-full px-3 py-2 border border-stone text-xs rounded-sm focus:outline-none focus:border-ink bg-paper"
                  />
                </div>

                <div>
                  <label htmlFor="grievanceOfficerAddress" className="block text-xs font-medium text-ink mb-1">
                    Grievance Officer Office Address
                  </label>
                  <input
                    type="text"
                    id="grievanceOfficerAddress"
                    placeholder="Office or facility address"
                    value={form.grievanceOfficerAddress}
                    onChange={(e) => setForm({ ...form, grievanceOfficerAddress: e.target.value })}
                    className="w-full px-3 py-2 border border-stone text-xs rounded-sm focus:outline-none focus:border-ink bg-paper"
                  />
                </div>
              </div>
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
                Variants with stock &le; this number trigger customer &quot;Only X left&quot; badges and admin warnings.
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
                  Welcome Coupon Code Prefix / Name
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
              <h2 className="text-sm font-semibold text-ink mb-1">Returns, Shipping & Refund Timing</h2>
              <p className="text-xs text-stone-dark">Define post-delivery return window, free return shipping, and refund processing turnaround.</p>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <input
                type="checkbox"
                id="freeReturnShipping"
                checked={form.freeReturnShipping}
                onChange={(e) => setForm({ ...form, freeReturnShipping: e.target.checked })}
                className="w-4 h-4 accent-ink cursor-pointer"
              />
              <div>
                <label htmlFor="freeReturnShipping" className="text-xs font-medium text-ink cursor-pointer">
                  Free Return Shipping
                </label>
                <p className="text-[11px] text-stone-dark">When enabled, return pickups and reverse logistics are provided at zero cost to customers.</p>
              </div>
            </div>

            <div>
              <label htmlFor="returnWindowDays" className="block text-xs font-medium text-ink mb-1">
                Return Eligibility Window (Days post-delivery)
              </label>
              <p className="text-[11px] text-stone-dark mb-2">
                Return requests submitted after this number of days from delivery are automatically rejected.
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

            <div>
              <label htmlFor="refundProcessingHours" className="block text-xs font-medium text-ink mb-1">
                Refund Processing Time (Hours)
              </label>
              <p className="text-[11px] text-stone-dark mb-2">
                Turnaround hours within which we initiate customer refunds upon return approval (1 to 240 hours).
              </p>
              <input
                type="number"
                id="refundProcessingHours"
                min="1"
                max="240"
                value={form.refundProcessingHours}
                onChange={(e) => setForm({ ...form, refundProcessingHours: Number(e.target.value) })}
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
                The cron job selects pending orders created &ge; this many hours ago for email reminders.
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

        {/* SEO */}
        {activeTab === "seo" && (
          <div className="space-y-5">
            <div>
              <h2 className="text-sm font-semibold text-ink mb-1">Search Engine Optimization & Indexing</h2>
              <p className="text-xs text-stone-dark">
                Control search engine indexing, Google Search Console verification, and default Open Graph image.
              </p>
            </div>

            {seoStatus && (
              <div
                className={`p-3 border text-xs rounded-sm ${
                  seoStatus.allowed
                    ? "bg-emerald-50 border-emerald-200 text-emerald-900"
                    : "bg-amber-50 border-amber-200 text-amber-900"
                }`}
              >
                <strong>Indexing status:</strong>{" "}
                {seoStatus.allowed
                  ? "Live — search engines are allowed to index this site."
                  : `Blocked (${seoStatus.blockedReason ?? "disabled"}).`}
              </div>
            )}

            <div className="flex items-start gap-2.5 pt-1">
              <input
                type="checkbox"
                id="seoIndexingEnabled"
                checked={form.seoIndexingEnabled}
                disabled={!isOwner}
                onChange={(e) => setForm({ ...form, seoIndexingEnabled: e.target.checked })}
                className="mt-0.5 rounded-none border-stone text-ink focus:ring-0 disabled:opacity-50"
              />
              <div>
                <label htmlFor="seoIndexingEnabled" className="text-xs font-medium text-ink cursor-pointer">
                  Allow Search Engine Indexing (Owner only)
                </label>
                <p className="text-[11px] text-stone-dark">
                  {isOwner
                    ? "When enabled in production on a public HTTPS domain, robots.txt and metadata allow indexing."
                    : "Only the store Owner can modify this setting."}
                </p>
              </div>
            </div>

            <div>
              <label htmlFor="googleSiteVerification" className="block text-xs font-medium text-ink mb-1">
                Google Site Verification Token
              </label>
              <p className="text-[11px] text-stone-dark mb-2">
                Verification code from Google Search Console (10–100 alphanumeric, _ or - characters).
              </p>
              <input
                type="text"
                id="googleSiteVerification"
                value={form.googleSiteVerification}
                onChange={(e) => setForm({ ...form, googleSiteVerification: e.target.value })}
                placeholder="e.g. abc123XYZ_token"
                className="w-full max-w-md px-3 py-2 border border-stone text-xs font-mono rounded-sm focus:outline-none focus:border-ink bg-paper"
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="ogDefaultImageUrl" className="block text-xs font-medium text-ink">
                Default Open Graph Image URL
              </label>
              <input
                type="text"
                id="ogDefaultImageUrl"
                value={form.ogDefaultImageUrl}
                onChange={(e) => setForm({ ...form, ogDefaultImageUrl: e.target.value })}
                placeholder="https://... or /og-default.jpg"
                className="w-full max-w-md px-3 py-2 border border-stone text-xs font-mono rounded-sm focus:outline-none focus:border-ink bg-paper"
              />
              <div className="flex items-center gap-2 pt-1">
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const fd = new FormData();
                    fd.set("image", file);
                    startTransition(async () => {
                      try {
                        const res = await uploadOgDefaultImageAction(fd);
                        setForm((prev) => ({ ...prev, ogDefaultImageUrl: res.url }));
                        setMessage({ type: "success", text: "OG default image uploaded." });
                      } catch (err: unknown) {
                        setMessage({
                          type: "error",
                          text: err instanceof Error ? err.message : "Failed to upload OG image.",
                        });
                      }
                    });
                  }}
                  className="text-xs file:mr-3 file:py-1.5 file:px-3 file:border file:border-stone file:bg-paper file:text-xs"
                />
              </div>
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
