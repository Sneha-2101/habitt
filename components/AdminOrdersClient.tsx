"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { formatINR } from "@/lib/money";
import { bulkMarkShipped } from "@/lib/actions/bulk-fulfillment";

interface OrderRow {
  id: string;
  displayId: string;
  customerName: string;
  customerPhone: string;
  customerEmail?: string | null;
  total: number;
  status: string;
  paymentMethod: string;
  createdAt: Date;
  itemCount: number;
}

interface AdminOrdersClientProps {
  orders: OrderRow[];
}

export default function AdminOrdersClient({ orders }: AdminOrdersClientProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showBulkShipModal, setShowBulkShipModal] = useState(false);
  const [courierName, setCourierName] = useState("Delhivery");
  const [awbInputs, setAwbInputs] = useState<Record<string, string>>({});
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const selectedOrders = orders.filter((o) => selectedIds.includes(o.id));
  const paidSelectedOrders = selectedOrders.filter((o) => o.status === "PAID");
  const allSelected = orders.length > 0 && selectedIds.length === orders.length;

  function toggleSelectAll() {
    if (allSelected) {
      setSelectedIds([]);
    } else {
      setSelectedIds(orders.map((o) => o.id));
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  }

  function handleBulkShipSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);

    const shipments = paidSelectedOrders.map((o) => ({
      orderId: o.id,
      courierName: courierName.trim(),
      awbNumber: (awbInputs[o.id] || "").trim(),
    }));

    for (const s of shipments) {
      if (!s.awbNumber) {
        setErrorMsg("All selected PAID orders must have a valid, non-empty AWB number entered.");
        return;
      }
    }

    startTransition(async () => {
      try {
        await bulkMarkShipped(shipments);
        setShowBulkShipModal(false);
        setSelectedIds([]);
        setAwbInputs({});
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : "Bulk shipping failed");
      }
    });
  }

  function exportSelectedCSV() {
    const targetOrders = orders.filter((o) => selectedIds.includes(o.id));
    const csvRows = [
      ["Order ID", "Customer Name", "Email", "Phone", "Status", "Items", "Total (INR)", "Date"],
      ...targetOrders.map((o) => [
        o.displayId,
        `"${o.customerName}"`,
        o.customerEmail || "",
        o.customerPhone,
        o.status,
        o.itemCount,
        (o.total / 100).toFixed(2),
        new Date(o.createdAt).toISOString().split("T")[0],
      ]),
    ];

    const csvContent = "data:text/csv;charset=utf-8," + csvRows.map((e) => e.join(",")).join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `habitt_selected_orders_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  return (
    <div className="space-y-4">
      {/* Bulk Actions Toolbar */}
      {selectedIds.length > 0 && (
        <div className="flex items-center justify-between p-3.5 bg-paper border border-stone rounded-sm">
          <span className="text-xs font-semibold text-ink">
            {selectedIds.length} order{selectedIds.length > 1 ? "s" : ""} selected
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowBulkShipModal(true)}
              className="px-3.5 py-1.5 bg-ink text-paper text-xs font-medium rounded-sm hover:bg-opacity-90"
            >
              🚚 Mark Selected Shipped
            </button>
            <button
              type="button"
              onClick={exportSelectedCSV}
              className="px-3.5 py-1.5 border border-stone bg-white text-ink text-xs font-medium rounded-sm hover:bg-paper"
            >
              📥 Export CSV
            </button>
            <button
              type="button"
              onClick={() => setSelectedIds([])}
              className="text-xs text-stone-dark hover:text-ink px-2"
            >
              Deselect All
            </button>
          </div>
        </div>
      )}

      {/* Bulk Ship Modal */}
      {showBulkShipModal && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white border border-stone p-6 rounded-sm max-w-lg w-full space-y-4 shadow-xl max-h-[85vh] overflow-y-auto">
            <h3 className="font-display text-lg font-medium text-ink">Bulk Shipping Dispatch</h3>
            <p className="text-xs text-stone-dark">
              Enter courier partner and individual real AWB tracking numbers for each selected order. Only <strong>PAID</strong> orders will be dispatched.
            </p>
            <form onSubmit={handleBulkShipSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-stone-dark mb-1">Courier Partner</label>
                <input
                  type="text"
                  required
                  value={courierName}
                  onChange={(e) => setCourierName(e.target.value)}
                  placeholder="e.g. Delhivery, Bluedart"
                  className="w-full px-3 py-2 text-xs border border-stone rounded-sm focus:outline-none focus:border-ink"
                />
              </div>

              <div className="space-y-3 pt-2 border-t border-stone/50">
                <p className="text-xs font-semibold text-ink">Selected Orders ({paidSelectedOrders.length} Eligible)</p>
                {paidSelectedOrders.map((o) => (
                  <div key={o.id} className="p-3 bg-paper border border-stone/50 rounded-sm space-y-1">
                    <div className="flex justify-between text-xs font-medium">
                      <span>Order #{o.displayId} ({o.customerName})</span>
                      <span>{formatINR(o.total)}</span>
                    </div>
                    <input
                      type="text"
                      required
                      placeholder="Enter real AWB / Tracking number..."
                      value={awbInputs[o.id] || ""}
                      onChange={(e) => setAwbInputs({ ...awbInputs, [o.id]: e.target.value })}
                      className="w-full px-2.5 py-1.5 text-xs border border-stone rounded-sm bg-white focus:outline-none focus:border-ink"
                    />
                  </div>
                ))}
                {paidSelectedOrders.length === 0 && (
                  <p className="text-xs text-clay">No selected orders are currently in PAID status.</p>
                )}
              </div>

              {errorMsg && <p className="text-xs text-clay font-medium">{errorMsg}</p>}
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowBulkShipModal(false)}
                  className="px-4 py-2 text-xs text-stone-dark hover:text-ink"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPending || paidSelectedOrders.length === 0}
                  className="px-5 py-2 bg-ink text-paper text-xs font-medium rounded-sm disabled:opacity-50"
                >
                  {isPending ? "DISPATCHING..." : "DISPATCH ORDERS"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Orders Table */}
      <div className="border border-stone bg-card rounded-sm">
        <div className="grid grid-cols-[40px_1.3fr_1.8fr_1fr_1fr_1fr_1fr] px-3.5 py-2.5 text-[11px] tracking-[0.06em] text-stone-dark border-b border-stone font-mono uppercase items-center">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={toggleSelectAll}
            className="cursor-pointer"
          />
          <span>ORDER ID</span>
          <span>CUSTOMER</span>
          <span>METHOD</span>
          <span>ITEMS</span>
          <span>TOTAL</span>
          <span>STATUS</span>
        </div>

        {orders.map((o) => {
          const isSelected = selectedIds.includes(o.id);
          return (
            <div
              key={o.id}
              className={`grid grid-cols-[40px_1.3fr_1.8fr_1fr_1fr_1fr_1fr] px-3.5 py-3 text-[13px] items-center border-b border-stone last:border-0 hover:bg-paper/50 transition-colors ${
                isSelected ? "bg-paper/80" : ""
              }`}
            >
              <input
                type="checkbox"
                checked={isSelected}
                onChange={() => toggleSelect(o.id)}
                className="cursor-pointer"
              />
              <Link href={`/admin/orders/${o.id}`} className="font-mono font-medium hover:underline text-ink">
                {o.displayId}
              </Link>
              <div>
                <span className="font-medium text-ink block">{o.customerName}</span>
                <span className="text-[11px] text-stone-dark">{o.customerEmail || o.customerPhone}</span>
              </div>
              <span className={`font-mono text-[11.5px] px-2 py-0.5 rounded-xs w-fit ${
                o.paymentMethod === "COD" ? "bg-amber-100 text-amber-900 border border-amber-300 font-semibold" : "text-stone-dark bg-paper border border-stone/50"
              }`}>
                {o.paymentMethod === "COD" ? "COD" : "Razorpay"}
              </span>
              <span className="font-mono text-[12.5px]">{o.itemCount}</span>
              <span className="font-mono text-[12.5px]">{formatINR(o.total)}</span>
              <span
                className={`text-[12.5px] font-medium ${
                  o.status === "PAID" || o.status === "DELIVERED"
                    ? "text-moss"
                    : o.status === "FAILED" || o.status === "CANCELLED"
                    ? "text-clay"
                    : "text-ink"
                }`}
              >
                {o.status}
              </span>
            </div>
          );
        })}

        {orders.length === 0 && <p className="px-3.5 py-8 text-sm text-stone-dark text-center">No orders found.</p>}
      </div>
    </div>
  );
}
