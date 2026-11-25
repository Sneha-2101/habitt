"use client";

import { useState } from "react";
import { generateMissingSkusAction, type SkuCandidate } from "@/lib/actions/variants";

export default function BulkSkuModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [candidates, setCandidates] = useState<SkuCandidate[] | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handlePreview = async () => {
    setLoading(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const res = await generateMissingSkusAction({ preview: true });
      setCandidates(res.candidates);
      if (res.candidates.length === 0) {
        setSuccessMessage("All variants already have unique SKUs assigned.");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to preview SKUs");
    } finally {
      setLoading(false);
    }
  };

  const handleApply = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await generateMissingSkusAction({ preview: false });
      setSuccessMessage(`Successfully generated and assigned ${res.assignedCount} SKUs.`);
      setCandidates(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to apply SKUs");
    } finally {
      setLoading(false);
    }
  };

  const openModal = () => {
    setIsOpen(true);
    setCandidates(null);
    setSuccessMessage(null);
    setError(null);
    handlePreview();
  };

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className="px-3 py-2 bg-paper border border-stone hover:bg-stone/20 text-xs font-mono uppercase tracking-wider transition-colors"
      >
        Generate Missing SKUs
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-card border border-stone max-w-2xl w-full p-6 space-y-4 shadow-xl">
            <div className="flex justify-between items-center">
              <h2 className="font-display text-lg font-medium">Bulk Generate Missing SKUs</h2>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="text-stone-dark hover:text-ink font-mono text-sm"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-stone-dark">
              Scans variants without an assigned SKU and generates unique SKUs in standard format:{" "}
              <code className="bg-paper px-1 py-0.5 border border-stone">PRODCODE-COLOR-SIZE</code>. Collisions
              receive incremental suffixes (-2, -3).
            </p>

            {error && (
              <div className="p-3 bg-red-50 border border-red-200 text-red-800 text-xs font-mono">
                {error}
              </div>
            )}

            {successMessage && (
              <div className="p-3 bg-emerald-50 border border-emerald-300 text-emerald-900 text-xs font-mono">
                {successMessage}
              </div>
            )}

            {loading && !candidates && (
              <div className="text-xs font-mono text-stone-dark py-4 text-center">Scanning catalog...</div>
            )}

            {candidates && candidates.length > 0 && (
              <div className="space-y-3">
                <div className="text-xs font-mono text-ink">
                  Found <span className="font-bold">{candidates.length}</span> variants missing SKUs:
                </div>
                <div className="border border-stone bg-white max-h-60 overflow-y-auto">
                  <table className="w-full text-xs font-mono text-left">
                    <thead className="bg-paper border-b border-stone text-stone-dark uppercase sticky top-0">
                      <tr>
                        <th className="p-2">Product</th>
                        <th className="p-2">Color</th>
                        <th className="p-2">Size</th>
                        <th className="p-2">Proposed SKU</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone/40">
                      {candidates.map((c) => (
                        <tr key={c.variantId} className="hover:bg-paper/50">
                          <td className="p-2 font-medium">{c.productName}</td>
                          <td className="p-2">{c.color || "—"}</td>
                          <td className="p-2">{c.size}</td>
                          <td className="p-2 font-semibold text-moss">{c.proposedSku}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-3 pt-3 border-t border-stone">
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="px-3 py-1.5 border border-stone text-xs font-mono uppercase"
              >
                Close
              </button>
              {candidates && candidates.length > 0 && (
                <button
                  type="button"
                  onClick={handleApply}
                  disabled={loading}
                  className="px-4 py-1.5 bg-moss text-paper text-xs font-mono uppercase hover:opacity-90 disabled:opacity-40"
                >
                  {loading ? "Applying..." : `Apply ${candidates.length} SKUs`}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
