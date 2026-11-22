"use client";

import { useState, useTransition } from "react";
import { formatINR } from "@/lib/money";
import { createPartialCreditNoteAction } from "@/lib/actions/gst";

export interface PartialCreditNoteItem {
  orderItemId: string;
  name: string;
  orderedQty: number;
  creditedQty: number;
  remainingQty: number;
  unitPricePaise: number;
}

interface PartialCreditNoteFormProps {
  orderId: string;
  items: PartialCreditNoteItem[];
  gstFeeMode: "COMPOSITE" | "SEPARATE";
  feeCredited: boolean;
  remainingCreditablePaise: number;
}

export default function PartialCreditNoteForm({
  orderId,
  items,
  gstFeeMode,
  feeCredited,
  remainingCreditablePaise,
}: PartialCreditNoteFormProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [quantities, setQuantities] = useState<Record<string, number>>(() =>
    Object.fromEntries(items.map((i) => [i.orderItemId, 0]))
  );
  const [includeFeeShare, setIncludeFeeShare] = useState(false);
  const [reason, setReason] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleQtyChange = (orderItemId: string, val: number, max: number) => {
    const clamped = Math.max(0, Math.min(val, max));
    setQuantities((prev) => ({ ...prev, [orderItemId]: clamped }));
  };

  const totalSelectedQty = Object.values(quantities).reduce((a, b) => a + b, 0);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (totalSelectedQty === 0) {
      setErrorMsg("Please select at least 1 item quantity to credit.");
      return;
    }
    if (!reason.trim()) {
      setErrorMsg("Please enter a reason for the credit note.");
      return;
    }

    startTransition(async () => {
      try {
        const payloadItems = Object.entries(quantities)
          .filter(([, qty]) => qty > 0)
          .map(([orderItemId, qty]) => ({ orderItemId, qty }));

        const res = await createPartialCreditNoteAction({
          orderId,
          items: payloadItems,
          includeFeeShare: gstFeeMode === "SEPARATE" && !feeCredited ? includeFeeShare : undefined,
          reason: reason.trim(),
        });

        if (res.success) {
          setSuccessMsg(`Credit note ${res.creditNote.number} issued successfully!`);
          setQuantities(Object.fromEntries(items.map((i) => [i.orderItemId, 0])));
          setReason("");
          setIsOpen(false);
        }
      } catch (err: unknown) {
        setErrorMsg(err instanceof Error ? err.message : "Failed to issue credit note");
      }
    });
  };

  if (remainingCreditablePaise <= 0) {
    return (
      <div className="text-xs text-stone-dark italic pt-2">
        Invoice is fully credited. No further credit notes can be issued.
      </div>
    );
  }

  return (
    <div className="pt-2">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="text-xs px-2.5 py-1 border border-stone text-ink hover:bg-stone/10 rounded font-medium flex items-center gap-1.5"
      >
        <span>{isOpen ? "▲ Hide Credit Note Form" : "▼ Create Partial Credit Note"}</span>
      </button>

      {isOpen && (
        <form onSubmit={handleSubmit} className="mt-3 p-3 bg-paper rounded border border-stone/40 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold text-ink uppercase tracking-wide">
              Issue Partial Credit Note
            </h4>
            <span className="text-[11px] text-stone-dark">
              Remaining creditable: <strong className="text-ink">{formatINR(remainingCreditablePaise)}</strong>
            </span>
          </div>

          {errorMsg && (
            <div className="p-2 text-xs bg-red-50 text-red-800 border border-red-200 rounded">
              {errorMsg}
            </div>
          )}
          {successMsg && (
            <div className="p-2 text-xs bg-emerald-50 text-emerald-800 border border-emerald-200 rounded">
              {successMsg}
            </div>
          )}

          <div className="space-y-2">
            <div className="grid grid-cols-12 text-[11px] font-semibold text-stone-dark pb-1 border-b border-stone/20">
              <span className="col-span-6">Item</span>
              <span className="col-span-2 text-center">Ordered</span>
              <span className="col-span-2 text-center">Credited</span>
              <span className="col-span-2 text-right">Credit Qty</span>
            </div>

            {items.map((item) => (
              <div key={item.orderItemId} className="grid grid-cols-12 text-xs items-center py-1">
                <div className="col-span-6 pr-2">
                  <span className="font-medium text-ink block truncate">{item.name}</span>
                  <span className="text-[10px] text-stone-dark">{formatINR(item.unitPricePaise)} each</span>
                </div>
                <div className="col-span-2 text-center text-stone-dark">{item.orderedQty}</div>
                <div className="col-span-2 text-center text-stone-dark">{item.creditedQty}</div>
                <div className="col-span-2 flex justify-end">
                  <input
                    type="number"
                    min="0"
                    max={item.remainingQty}
                    value={quantities[item.orderItemId] ?? 0}
                    onChange={(e) =>
                      handleQtyChange(item.orderItemId, parseInt(e.target.value, 10) || 0, item.remainingQty)
                    }
                    disabled={item.remainingQty <= 0 || isPending}
                    className="w-16 px-2 py-1 text-xs border border-stone rounded font-mono text-right bg-white disabled:bg-stone/20"
                  />
                </div>
              </div>
            ))}
          </div>

          {gstFeeMode === "SEPARATE" ? (
            <div className="pt-2 border-t border-stone/20 flex items-center justify-between text-xs">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeFeeShare}
                  disabled={feeCredited || isPending}
                  onChange={(e) => setIncludeFeeShare(e.target.checked)}
                  className="rounded border-stone"
                />
                <span className="text-ink">
                  Include proportional fee share (shipping & COD fees)
                </span>
              </label>
              {feeCredited && (
                <span className="text-[11px] text-stone-dark italic">Fees already credited</span>
              )}
            </div>
          ) : (
            <div className="text-[11px] text-stone-dark pt-1">
              <em>Fees were spread pro-rata into goods line prices at invoice issuance. Crediting goods automatically refunds fee share.</em>
            </div>
          )}

          <div>
            <label className="block text-[11px] font-medium text-ink mb-1">
              Reason for Credit Note <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Customer returned damaged item / partial return"
              required
              disabled={isPending}
              className="w-full px-2.5 py-1.5 border border-stone text-xs rounded bg-white"
            />
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="px-3 py-1 text-xs border border-stone text-stone-dark hover:bg-stone/10 rounded"
              disabled={isPending}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending || totalSelectedQty === 0}
              className="px-3 py-1 text-xs bg-moss text-white hover:bg-moss/90 rounded font-medium disabled:opacity-50"
            >
              {isPending ? "Issuing..." : "Issue Credit Note"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
