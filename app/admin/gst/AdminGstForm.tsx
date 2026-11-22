"use client";

import { useState, useTransition } from "react";
import { formatINR } from "@/lib/money";
import {
  updateGstSettings,
  createGstRule,
  toggleGstRuleActive,
  deleteGstRule,
} from "@/lib/actions/gst";
import { INDIAN_STATES_GST } from "@/lib/gst/states";

interface CategoryOption {
  id: string;
  name: string;
}

interface GstRuleItem {
  id: string;
  name: string;
  hsn: string | null;
  categoryId: string | null;
  minUnitPaise: number;
  maxUnitPaise: number | null;
  ratePercent: number | string;
  active: boolean;
}

interface AdminGstFormProps {
  settings: {
    gstEnabled: boolean;
    gstRate: number;
    gstin: string | null;
    gstFeeMode: "COMPOSITE" | "SEPARATE";
    gstFeeRate: number;
    invoicePrefix: string;
    businessState: string | null;
  };
  rules: GstRuleItem[];
  categories: CategoryOption[];
}

export default function AdminGstForm({
  settings,
  rules,
  categories,
}: AdminGstFormProps) {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  // Settings State
  const [gstEnabled, setGstEnabled] = useState(settings.gstEnabled);
  const [gstRate, setGstRate] = useState(settings.gstRate);
  const [gstin, setGstin] = useState(settings.gstin || "");
  const [gstFeeMode, setGstFeeMode] = useState(settings.gstFeeMode);
  const [gstFeeRate, setGstFeeRate] = useState(settings.gstFeeRate);
  const [invoicePrefix, setInvoicePrefix] = useState(settings.invoicePrefix);
  const [businessState, setBusinessState] = useState(settings.businessState || "");

  // New Rule State
  const [newRuleName, setNewRuleName] = useState("");
  const [newRuleHsn, setNewRuleHsn] = useState("");
  const [newRuleCategory, setNewRuleCategory] = useState("");
  const [newRuleMinPrice, setNewRuleMinPrice] = useState("0");
  const [newRuleMaxPrice, setNewRuleMaxPrice] = useState("");
  const [newRuleRate, setNewRuleRate] = useState("5");

  const handleSaveSettings = (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);

    startTransition(async () => {
      try {
        await updateGstSettings({
          gstEnabled,
          gstRate: Number(gstRate),
          gstin: gstin.trim() || null,
          gstFeeMode,
          gstFeeRate: Number(gstFeeRate),
          invoicePrefix: invoicePrefix.trim() || "HB",
          businessState: businessState.trim() || null,
        });
        setMessage({ text: "GST Settings saved successfully!" });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Failed to save GST settings";
        setMessage({ text: msg, error: true });
      }
    });
  };

  const handleCreateRule = (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);

    startTransition(async () => {
      try {
        const minPaise = Math.round(Number(newRuleMinPrice) * 100);
        const maxPaise = newRuleMaxPrice.trim()
          ? Math.round(Number(newRuleMaxPrice) * 100)
          : null;

        await createGstRule({
          name: newRuleName,
          hsn: newRuleHsn.trim() || null,
          categoryId: newRuleCategory.trim() || null,
          minUnitPaise: minPaise,
          maxUnitPaise: maxPaise,
          ratePercent: Number(newRuleRate),
          active: true,
        });

        setNewRuleName("");
        setNewRuleHsn("");
        setNewRuleCategory("");
        setNewRuleMinPrice("0");
        setNewRuleMaxPrice("");
        setNewRuleRate("5");
        setMessage({ text: "GST Rule created successfully!" });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Failed to create GST Rule";
        setMessage({ text: msg, error: true });
      }
    });
  };

  const handleToggleRule = (id: string) => {
    startTransition(async () => {
      try {
        await toggleGstRuleActive(id);
        setMessage({ text: "Rule status updated!" });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Failed to toggle rule";
        setMessage({ text: msg, error: true });
      }
    });
  };

  const handleDeleteRule = (id: string) => {
    if (!confirm("Are you sure you want to delete this GST rule?")) return;
    startTransition(async () => {
      try {
        await deleteGstRule(id);
        setMessage({ text: "Rule deleted successfully!" });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Failed to delete rule";
        setMessage({ text: msg, error: true });
      }
    });
  };

  const categoryMap = new Map(categories.map((c) => [c.id, c.name]));

  return (
    <div className="space-y-8">
      {message && (
        <div
          className={`p-3 text-xs rounded border ${
            message.error
              ? "bg-red-50 text-red-800 border-red-200"
              : "bg-emerald-50 text-emerald-800 border-emerald-200"
          }`}
        >
          {message.text}
        </div>
      )}

      {/* Global GST & Invoice Settings */}
      <form onSubmit={handleSaveSettings} className="bg-white p-6 border border-stone rounded-sm space-y-6">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-stone-dark">
            Global GST & Invoice Configuration
          </h2>
          <p className="text-xs text-stone-dark mt-1">
            Controls tax calculation, document generation mode, and sequence prefix.
          </p>
        </div>

        <div className="space-y-4 text-xs">
          <div className="flex items-center justify-between p-3 bg-paper/50 rounded border border-stone/30">
            <div>
              <span className="font-medium text-ink block text-sm">Enable GST Invoicing</span>
              <span className="text-stone-dark">
                When enabled, Tax Invoices (HB/YY-YY/00001) are generated on dispatch. When disabled, Order Receipts are issued.
              </span>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={gstEnabled}
                onChange={(e) => setGstEnabled(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-stone/40 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-stone after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-moss"></div>
            </label>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block font-medium text-ink mb-1">Company GSTIN</label>
              <input
                type="text"
                value={gstin}
                onChange={(e) => setGstin(e.target.value.toUpperCase())}
                placeholder="e.g. 32AAAAA0000A1Z5"
                className="w-full px-3 py-1.5 border border-stone rounded-sm bg-paper font-mono"
              />
              <span className="text-[11px] text-stone-dark">15-digit GST identification number</span>
            </div>

            <div>
              <label className="block font-medium text-ink mb-1">Seller Business State</label>
              <select
                value={businessState}
                onChange={(e) => setBusinessState(e.target.value)}
                className="w-full px-3 py-1.5 border border-stone rounded-sm bg-paper"
              >
                <option value="">Select state...</option>
                {INDIAN_STATES_GST.map((s) => (
                  <option key={s.code} value={s.name}>
                    {s.name} ({s.code}) - TIN {s.tin}
                  </option>
                ))}
              </select>
              <span className="text-[11px] text-stone-dark">Used for Intra-state (CGST+SGST) vs Inter-state (IGST) split</span>
            </div>

            <div>
              <label className="block font-medium text-ink mb-1">Fallback Flat GST Rate (%)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                max="100"
                value={gstRate}
                onChange={(e) => setGstRate(Number(e.target.value))}
                required
                className="w-full px-3 py-1.5 border border-stone rounded-sm bg-paper font-mono"
              />
              <span className="text-[11px] text-stone-dark">Used when no specific HSN / Category rule matches</span>
            </div>

            <div>
              <label className="block font-medium text-ink mb-1">Invoice Number Prefix</label>
              <input
                type="text"
                value={invoicePrefix}
                onChange={(e) => setInvoicePrefix(e.target.value.toUpperCase())}
                required
                className="w-full px-3 py-1.5 border border-stone rounded-sm bg-paper font-mono"
              />
              <span className="text-[11px] text-stone-dark">Prefix for tax invoices e.g. HB → HB/2026-27/00001</span>
            </div>

            <div>
              <label className="block font-medium text-ink mb-1">Fee GST Mode</label>
              <select
                value={gstFeeMode}
                onChange={(e) => setGstFeeMode(e.target.value as "COMPOSITE" | "SEPARATE")}
                className="w-full px-3 py-1.5 border border-stone rounded-sm bg-paper"
              >
                <option value="COMPOSITE">COMPOSITE (Spread pro-rata across goods)</option>
                <option value="SEPARATE">SEPARATE (Taxed as distinct line item)</option>
              </select>
              <span className="text-[11px] text-stone-dark">Determines how shipping and COD fees are taxed</span>
            </div>

            <div>
              <label className="block font-medium text-ink mb-1">Separate Fee GST Rate (%)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                max="100"
                value={gstFeeRate}
                onChange={(e) => setGstFeeRate(Number(e.target.value))}
                required
                className="w-full px-3 py-1.5 border border-stone rounded-sm bg-paper font-mono"
              />
              <span className="text-[11px] text-stone-dark">GST rate applied to fee lines in SEPARATE mode (default 18%)</span>
            </div>
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <button
            type="submit"
            disabled={isPending}
            className="px-4 py-2 bg-ink text-paper rounded text-xs font-semibold hover:bg-ink/90 disabled:opacity-50"
          >
            {isPending ? "Saving Settings..." : "Save GST Settings"}
          </button>
        </div>
      </form>

      {/* GST Rules Management */}
      <div className="bg-white p-6 border border-stone rounded-sm space-y-6">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-stone-dark">
            GST Tax Rules (HSN / Category Slabs)
          </h2>
          <p className="text-xs text-stone-dark mt-1">
            Rules are evaluated in order of specificity (HSN + Price Slab → Category + Price Slab → Fallback).
          </p>
        </div>

        {/* Existing Rules Table */}
        <div className="border border-stone rounded-sm overflow-hidden text-xs">
          <table className="w-full text-left border-collapse">
            <thead className="bg-paper border-b border-stone text-stone-dark">
              <tr>
                <th className="p-2.5">Rule Name</th>
                <th className="p-2.5">HSN Code</th>
                <th className="p-2.5">Category</th>
                <th className="p-2.5">Price Slab (₹)</th>
                <th className="p-2.5 text-center">Rate</th>
                <th className="p-2.5 text-center">Status</th>
                <th className="p-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone/40">
              {rules.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-4 text-center text-stone-dark">
                    No GST rules configured. Fallback rate ({gstRate}%) will apply to all items.
                  </td>
                </tr>
              ) : (
                rules.map((rule) => {
                  const minPrice = formatINR(rule.minUnitPaise);
                  const maxPrice = rule.maxUnitPaise ? formatINR(rule.maxUnitPaise) : "No Limit";
                  return (
                    <tr key={rule.id} className={rule.active ? "" : "bg-stone/10 text-stone-dark"}>
                      <td className="p-2.5 font-medium text-ink">{rule.name}</td>
                      <td className="p-2.5 font-mono">{rule.hsn || "—"}</td>
                      <td className="p-2.5">{rule.categoryId ? categoryMap.get(rule.categoryId) || rule.categoryId : "All"}</td>
                      <td className="p-2.5 font-mono">
                        {minPrice} – {maxPrice}
                      </td>
                      <td className="p-2.5 text-center font-bold text-ink">{Number(rule.ratePercent)}%</td>
                      <td className="p-2.5 text-center">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                            rule.active
                              ? "bg-emerald-100 text-emerald-800"
                              : "bg-stone/20 text-stone-dark"
                          }`}
                        >
                          {rule.active ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td className="p-2.5 text-right space-x-2">
                        <button
                          type="button"
                          onClick={() => handleToggleRule(rule.id)}
                          disabled={isPending}
                          className="text-[11px] text-moss hover:underline font-medium"
                        >
                          {rule.active ? "Disable" : "Enable"}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteRule(rule.id)}
                          disabled={isPending}
                          className="text-[11px] text-red-700 hover:underline font-medium"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Add New Rule Form */}
        <form onSubmit={handleCreateRule} className="p-4 bg-paper/60 border border-stone/40 rounded-sm space-y-4 text-xs">
          <h3 className="font-semibold text-ink uppercase tracking-wider text-[11px]">
            + Add New GST Tax Rule
          </h3>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-stone-dark mb-1">Rule Name</label>
              <input
                type="text"
                value={newRuleName}
                onChange={(e) => setNewRuleName(e.target.value)}
                placeholder="e.g. Apparel under Rs 1000"
                required
                className="w-full px-2.5 py-1.5 border border-stone rounded-sm bg-white"
              />
            </div>

            <div>
              <label className="block text-stone-dark mb-1">HSN Code (Optional)</label>
              <input
                type="text"
                value={newRuleHsn}
                onChange={(e) => setNewRuleHsn(e.target.value)}
                placeholder="e.g. 6109"
                className="w-full px-2.5 py-1.5 border border-stone rounded-sm bg-white font-mono"
              />
            </div>

            <div>
              <label className="block text-stone-dark mb-1">Category (Optional)</label>
              <select
                value={newRuleCategory}
                onChange={(e) => setNewRuleCategory(e.target.value)}
                className="w-full px-2.5 py-1.5 border border-stone rounded-sm bg-white"
              >
                <option value="">All Categories</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-stone-dark mb-1">Min Net Unit Price (₹)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={newRuleMinPrice}
                onChange={(e) => setNewRuleMinPrice(e.target.value)}
                required
                className="w-full px-2.5 py-1.5 border border-stone rounded-sm bg-white font-mono"
              />
            </div>

            <div>
              <label className="block text-stone-dark mb-1">Max Net Unit Price (₹, Optional)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={newRuleMaxPrice}
                onChange={(e) => setNewRuleMaxPrice(e.target.value)}
                placeholder="Leave blank for no upper limit"
                className="w-full px-2.5 py-1.5 border border-stone rounded-sm bg-white font-mono"
              />
            </div>

            <div>
              <label className="block text-stone-dark mb-1">GST Rate (%)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                max="100"
                value={newRuleRate}
                onChange={(e) => setNewRuleRate(e.target.value)}
                required
                className="w-full px-2.5 py-1.5 border border-stone rounded-sm bg-white font-mono font-bold"
              />
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={isPending}
              className="px-4 py-1.5 bg-moss text-paper rounded text-xs font-semibold hover:bg-moss/90 disabled:opacity-50"
            >
              {isPending ? "Adding Rule..." : "Add Tax Rule"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
