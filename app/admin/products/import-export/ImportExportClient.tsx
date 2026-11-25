"use client";

import { useState } from "react";
import Link from "next/link";
import { parseAndPlanProductsCsvAction, applyProductsImportAction } from "@/lib/actions/csv-products";
import type { ImportPlan, ImportApplyResult } from "@/lib/admin/csv-products";

export default function ImportExportClient() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [result, setResult] = useState<ImportApplyResult | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    setPlan(null);
    setResult(null);
    const selected = e.target.files?.[0];
    if (selected) {
      setFile(selected);
    }
  };

  const handlePreview = async () => {
    if (!file) {
      setError("Please select a CSV file first");
      return;
    }

    setLoading(true);
    setError(null);
    setPlan(null);
    setResult(null);

    try {
      const text = await file.text();
      const importPlan = await parseAndPlanProductsCsvAction(text);
      setPlan(importPlan);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to parse CSV");
    } finally {
      setLoading(false);
    }
  };

  const handleApply = async () => {
    if (!plan) return;
    setLoading(true);
    setError(null);

    try {
      const applyRes = await applyProductsImportAction(plan);
      setResult(applyRes);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to apply import");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Export Section */}
      <div className="bg-card border border-stone p-6 space-y-4">
        <h2 className="font-display text-lg font-medium">Export Catalog</h2>
        <p className="text-sm text-stone-dark">
          Download current products and variants as a standard CSV format (includes slug, category, price, variant SKU, stock). OWNER accounts will also include costPrice column.
        </p>
        <div>
          <a
            href="/api/admin/products/export"
            download
            className="inline-flex items-center px-4 py-2 bg-paper border border-stone hover:bg-stone/20 text-xs font-mono uppercase tracking-wider transition-colors"
          >
            Download Products CSV
          </a>
        </div>
      </div>

      {/* Import Section */}
      <div className="bg-card border border-stone p-6 space-y-5">
        <h2 className="font-display text-lg font-medium">Import Catalog CSV</h2>
        <p className="text-sm text-stone-dark">
          Upload a CSV file conforming to the standard catalog format (Max 2MB / 5,000 rows).
          Review planned creates, updates, and unchanged rows before applying.
        </p>

        <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={handleFileChange}
            className="text-xs font-mono file:mr-3 file:py-2 file:px-3 file:border file:border-stone file:bg-paper file:text-xs file:font-mono hover:file:bg-stone/20"
          />
          <button
            type="button"
            onClick={handlePreview}
            disabled={!file || loading}
            className="px-4 py-2 bg-moss text-paper text-xs font-mono uppercase tracking-wider hover:opacity-90 disabled:opacity-40 transition-opacity"
          >
            {loading ? "Analyzing..." : "Preview Import"}
          </button>
        </div>

        {error && (
          <div className="p-3 bg-red-50 border border-red-200 text-red-800 text-xs font-mono">
            {error}
          </div>
        )}

        {result && (
          <div className="p-4 bg-emerald-50 border border-emerald-300 text-emerald-900 space-y-2">
            <div className="font-semibold text-xs font-mono uppercase">Import Applied Successfully</div>
            <div className="text-xs space-y-1">
              <div>Total Applied: {result.appliedCount} | Skipped: {result.skippedCount}</div>
              <div>Created Products: {result.createdProducts} | Created Variants: {result.createdVariants} | Updated Variants: {result.updatedVariants}</div>
            </div>
            <div className="pt-2">
              <Link href="/admin/products" className="text-xs text-moss underline font-medium">
                Return to Products Catalog
              </Link>
            </div>
          </div>
        )}

        {plan && !result && (
          <div className="space-y-4 pt-4 border-t border-stone">
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              <div className="p-3 bg-white border border-stone">
                <div className="text-[10.5px] font-mono text-stone-dark uppercase">Total Rows</div>
                <div className="text-xl font-mono font-semibold">{plan.totalRows}</div>
              </div>
              <div className="p-3 bg-white border border-emerald-300 text-emerald-900">
                <div className="text-[10.5px] font-mono uppercase">Creates</div>
                <div className="text-xl font-mono font-semibold">{plan.createCount}</div>
              </div>
              <div className="p-3 bg-white border border-blue-300 text-blue-900">
                <div className="text-[10.5px] font-mono uppercase">Updates</div>
                <div className="text-xl font-mono font-semibold">{plan.updateCount}</div>
              </div>
              <div className="p-3 bg-white border border-stone text-stone-dark">
                <div className="text-[10.5px] font-mono uppercase">Unchanged</div>
                <div className="text-xl font-mono font-semibold">{plan.unchangedCount}</div>
              </div>
              <div className="p-3 bg-white border border-red-300 text-red-900">
                <div className="text-[10.5px] font-mono uppercase">Errors</div>
                <div className="text-xl font-mono font-semibold">{plan.errorCount}</div>
              </div>
            </div>

            <div className="flex justify-between items-center">
              <div className="text-xs text-stone-dark font-mono">
                {plan.errorCount > 0 ? "Fix CSV errors before applying" : "Ready to apply changes to catalog"}
              </div>
              <button
                type="button"
                onClick={handleApply}
                disabled={loading || plan.errorCount > 0 || (plan.createCount === 0 && plan.updateCount === 0)}
                className="px-4 py-2 bg-moss text-paper text-xs font-mono uppercase tracking-wider hover:opacity-90 disabled:opacity-40 transition-opacity"
              >
                {loading ? "Applying..." : "Apply Import"}
              </button>
            </div>

            <div className="border border-stone bg-white max-h-96 overflow-y-auto">
              <table className="w-full text-xs font-mono text-left">
                <thead className="bg-paper border-b border-stone text-stone-dark uppercase sticky top-0">
                  <tr>
                    <th className="p-2">Row</th>
                    <th className="p-2">Action</th>
                    <th className="p-2">Product Slug</th>
                    <th className="p-2">Color</th>
                    <th className="p-2">Size</th>
                    <th className="p-2">SKU</th>
                    <th className="p-2">Changes / Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone/40">
                  {plan.rows.slice(0, 100).map((r) => (
                    <tr key={r.rowNumber} className="hover:bg-paper/50">
                      <td className="p-2 text-stone-dark">{r.rowNumber}</td>
                      <td className="p-2">
                        <span
                          className={`px-1.5 py-0.5 text-[10px] font-mono uppercase border ${
                            r.action === "CREATE"
                              ? "bg-emerald-50 text-emerald-800 border-emerald-300"
                              : r.action === "UPDATE"
                              ? "bg-blue-50 text-blue-800 border-blue-300"
                              : r.action === "ERROR"
                              ? "bg-red-50 text-red-800 border-red-300"
                              : "bg-stone/10 text-stone-dark border-stone"
                          }`}
                        >
                          {r.action}
                        </span>
                      </td>
                      <td className="p-2 font-medium">{r.productSlug}</td>
                      <td className="p-2">{r.color || "—"}</td>
                      <td className="p-2">{r.size}</td>
                      <td className="p-2 text-stone-dark">{r.sku || "—"}</td>
                      <td className="p-2">
                        {r.error ? (
                          <span className="text-red-700">{r.error}</span>
                        ) : r.changes && Object.keys(r.changes).length > 0 ? (
                          <span className="text-blue-900">
                            {Object.entries(r.changes)
                              .map(([k, v]) => `${k}: ${String(v.before)} -> ${String(v.after)}`)
                              .join(", ")}
                          </span>
                        ) : (
                          <span className="text-stone-dark">No change</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
