"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createInfluencerAction,
  setInfluencerActiveAction,
  updateInfluencerAction,
  updateInfluencerSettingsAction,
} from "@/lib/actions/influencers";
import { formatINR } from "@/lib/money";
import type { InfluencerStatsRow } from "@/lib/influencers/stats";

export default function InfluencersClient({
  influencers,
  initialCookieDays,
  siteUrl,
  fromIst,
  toIst,
}: {
  influencers: InfluencerStatsRow[];
  initialCookieDays: number;
  siteUrl: string | null;
  fromIst: string;
  toIst: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const [newName, setNewName] = useState("");
  const [newCode, setNewCode] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [newDiscount, setNewDiscount] = useState("");

  const [cookieDays, setCookieDays] = useState(String(initialCookieDays));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    name: "",
    code: "",
    email: "",
    notes: "",
    discountPercent: "",
  });

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    startTransition(async () => {
      try {
        await createInfluencerAction({
          name: newName,
          code: newCode,
          email: newEmail || null,
          notes: newNotes || null,
          discountPercent: newDiscount === "" ? 0 : Number(newDiscount),
        });
        setNewName("");
        setNewCode("");
        setNewEmail("");
        setNewNotes("");
        setNewDiscount("");
        setMessage({ type: "success", text: "Influencer created." });
        router.refresh();
      } catch (err) {
        setMessage({
          type: "error",
          text: err instanceof Error ? err.message : "Failed to create influencer.",
        });
      }
    });
  }

  function startEdit(row: InfluencerStatsRow) {
    setEditingId(row.id);
    setEditForm({
      name: row.name,
      code: row.code,
      email: "",
      notes: row.notes ?? "",
      discountPercent: row.discountPercent !== null ? String(row.discountPercent) : "",
    });
  }

  function handleSaveEdit(id: string) {
    setMessage(null);
    startTransition(async () => {
      try {
        await updateInfluencerAction(id, {
          name: editForm.name,
          code: editForm.code,
          email: editForm.email || null,
          notes: editForm.notes || null,
          discountPercent: editForm.discountPercent === "" ? 0 : Number(editForm.discountPercent),
        });
        setEditingId(null);
        setMessage({ type: "success", text: "Influencer updated." });
        router.refresh();
      } catch (err) {
        setMessage({
          type: "error",
          text: err instanceof Error ? err.message : "Failed to update influencer.",
        });
      }
    });
  }

  function handleToggleActive(row: InfluencerStatsRow) {
    setMessage(null);
    startTransition(async () => {
      try {
        await setInfluencerActiveAction(row.id, !row.active);
        setMessage({
          type: "success",
          text: `${row.name} ${row.active ? "deactivated" : "activated"}.`,
        });
        router.refresh();
      } catch (err) {
        setMessage({
          type: "error",
          text: err instanceof Error ? err.message : "Failed to update status.",
        });
      }
    });
  }

  function handleSaveCookieDays(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    startTransition(async () => {
      try {
        await updateInfluencerSettingsAction({
          influencerCookieDays: Number(cookieDays),
        });
        setMessage({ type: "success", text: "Cookie window updated." });
        router.refresh();
      } catch (err) {
        setMessage({
          type: "error",
          text: err instanceof Error ? err.message : "Failed to update cookie days.",
        });
      }
    });
  }

  return (
    <div className="space-y-8">
      {message && (
        <div
          className={`p-3 text-xs border ${
            message.type === "success"
              ? "bg-emerald-50 border-emerald-200 text-emerald-800"
              : "bg-red-50 border-red-200 text-red-800"
          }`}
        >
          {message.text}
        </div>
      )}

      {/* Cookie Days Setting */}
      <form
        onSubmit={handleSaveCookieDays}
        className="border border-stone bg-card p-4 flex flex-wrap items-end gap-4"
      >
        <div>
          <label className="block text-[11px] uppercase tracking-wider text-stone-dark mb-1">
            Attribution Cookie Window (Days, 1–90)
          </label>
          <input
            type="number"
            min={1}
            max={90}
            value={cookieDays}
            onChange={(e) => setCookieDays(e.target.value)}
            required
            className="w-32 px-3 py-2 border border-stone bg-paper text-xs font-mono"
          />
        </div>
        <button
          type="submit"
          disabled={isPending}
          className="px-4 py-2 bg-ink text-paper text-xs uppercase tracking-wider disabled:opacity-50"
        >
          Save Window
        </button>
      </form>

      {/* Create Influencer */}
      <form onSubmit={handleCreate} className="border border-stone bg-card p-5 space-y-4">
        <h2 className="text-sm font-medium text-ink">Add Influencer</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <input
            type="text"
            required
            placeholder="Name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="px-3 py-2 border border-stone bg-paper text-xs"
          />
          <input
            type="text"
            required
            placeholder="Code (e.g. AARAV10)"
            value={newCode}
            onChange={(e) => setNewCode(e.target.value)}
            className="px-3 py-2 border border-stone bg-paper text-xs font-mono uppercase"
          />
          <input
            type="email"
            placeholder="Email (optional, self-order detection)"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            className="px-3 py-2 border border-stone bg-paper text-xs"
          />
          <input
            type="number"
            min={0}
            max={100}
            placeholder="Discount % (0 = tracking only)"
            value={newDiscount}
            onChange={(e) => setNewDiscount(e.target.value)}
            className="px-3 py-2 border border-stone bg-paper text-xs font-mono"
          />
          <input
            type="text"
            maxLength={500}
            placeholder="Notes (optional)"
            value={newNotes}
            onChange={(e) => setNewNotes(e.target.value)}
            className="px-3 py-2 border border-stone bg-paper text-xs"
          />
        </div>
        <button
          type="submit"
          disabled={isPending}
          className="px-5 py-2 bg-ink text-paper text-xs uppercase tracking-wider disabled:opacity-50"
        >
          Create Influencer
        </button>
      </form>

      {/* Stats Table */}
      <div className="border border-stone bg-card overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-stone bg-paper text-[11px] uppercase tracking-wider text-stone-dark">
            <tr>
              <th className="p-3">Influencer</th>
              <th className="p-3">Code & Link</th>
              <th className="p-3">Discount</th>
              <th className="p-3">Status</th>
              <th className="p-3 text-right">Placed</th>
              <th className="p-3 text-right">Delivered</th>
              <th className="p-3 text-right">Goods Sales</th>
              <th className="p-3 text-right">Refunded</th>
              <th className="p-3 text-right">Net Goods</th>
              <th className="p-3 text-right">Self-Orders</th>
              <th className="p-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone/50">
            {influencers.length === 0 && (
              <tr>
                <td colSpan={11} className="p-6 text-center text-stone-dark">
                  No influencers yet.
                </td>
              </tr>
            )}
            {influencers.map((row) => {
              const linkPath = `/i/${row.code}`;
              const fullLink = siteUrl ? `${siteUrl}${linkPath}` : linkPath;
              const isEditing = editingId === row.id;

              return (
                <tr key={row.id} className="align-top">
                  <td className="p-3">
                    {isEditing ? (
                      <input
                        type="text"
                        value={editForm.name}
                        onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                        className="w-36 px-2 py-1 border border-stone bg-paper text-xs"
                      />
                    ) : (
                      <div>
                        <Link
                          href={`/admin/influencers/${row.id}?from=${fromIst}&to=${toIst}`}
                          className="font-medium text-ink underline hover:opacity-80"
                        >
                          {row.name}
                        </Link>
                        {row.notes && (
                          <div className="text-[11px] text-stone-dark mt-0.5">{row.notes}</div>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="p-3 font-mono">
                    {isEditing ? (
                      <div className="space-y-1">
                        <input
                          type="text"
                          value={editForm.code}
                          onChange={(e) => setEditForm({ ...editForm, code: e.target.value })}
                          className="w-32 px-2 py-1 border border-stone bg-paper text-xs font-mono uppercase"
                        />
                        <input
                          type="email"
                          placeholder={row.hasEmail ? "Replace email (optional)" : "Email (optional)"}
                          value={editForm.email}
                          onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                          className="w-36 px-2 py-1 border border-stone bg-paper text-[11px] font-sans block"
                        />
                        <input
                          type="text"
                          placeholder="Notes"
                          value={editForm.notes}
                          onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                          className="w-36 px-2 py-1 border border-stone bg-paper text-[11px] font-sans block"
                        />
                      </div>
                    ) : (
                      <div>
                        <div className="font-medium">{row.code}</div>
                        <div className="text-[10.5px] text-stone-dark break-all">{fullLink}</div>
                      </div>
                    )}
                  </td>
                  <td className="p-3">
                    {isEditing ? (
                      <input
                        type="number"
                        min={0}
                        max={100}
                        placeholder="0"
                        value={editForm.discountPercent}
                        onChange={(e) =>
                          setEditForm({ ...editForm, discountPercent: e.target.value })
                        }
                        className="w-16 px-2 py-1 border border-stone bg-paper text-xs font-mono"
                      />
                    ) : row.discountPercent ? (
                      <span className="font-mono">{row.discountPercent}%</span>
                    ) : (
                      <span className="text-stone-dark">Tracking only</span>
                    )}
                  </td>
                  <td className="p-3">
                    <span
                      className={`inline-block px-2 py-0.5 text-[10.5px] uppercase font-mono border ${
                        row.active
                          ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                          : "bg-stone/30 border-stone text-stone-dark"
                      }`}
                    >
                      {row.active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="p-3 text-right font-mono">{row.summary.ordersPlaced}</td>
                  <td className="p-3 text-right font-mono">{row.summary.ordersDelivered}</td>
                  <td className="p-3 text-right font-mono">
                    {formatINR(row.summary.goodsSalesPaise)}
                  </td>
                  <td className="p-3 text-right font-mono">
                    {formatINR(row.summary.refundedGoodsPaise)}
                  </td>
                  <td className="p-3 text-right font-mono font-medium">
                    {formatINR(row.summary.netGoodsPaise)}
                  </td>
                  <td className="p-3 text-right font-mono">{row.summary.selfOrders}</td>
                  <td className="p-3 space-y-1">
                    {isEditing ? (
                      <div className="flex gap-1">
                        <button
                          type="button"
                          onClick={() => handleSaveEdit(row.id)}
                          disabled={isPending}
                          className="px-2 py-1 bg-ink text-paper text-[11px]"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="px-2 py-1 border border-stone text-[11px]"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => startEdit(row)}
                          className="underline text-ink text-[11px]"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleToggleActive(row)}
                          disabled={isPending}
                          className="underline text-stone-dark hover:text-ink text-[11px]"
                        >
                          {row.active ? "Deactivate" : "Activate"}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
