"use client";

import { useState, useTransition } from "react";
import { ContentBlocks } from "@/components/ContentBlocks";
import {
  saveContentAction,
  uploadBannerImageAction,
  createBannerAction,
  updateBannerAction,
  deleteBannerAction,
  reorderBannersAction,
} from "@/lib/actions/content";

export interface BannerItem {
  id: string;
  imageUrl: string;
  imageAlt: string;
  heading: string;
  subheading: string | null;
  ctaLabel: string | null;
  ctaHref: string | null;
  sortOrder: number;
  isActive: boolean;
  startsAt: string | null;
  endsAt: string | null;
}

export interface ContentItem {
  key: string;
  title: string | null;
  body: string;
  isPublished: boolean;
}

const POLICY_KEYS = [
  { key: "policy.shipping", label: "Shipping & Delivery Policy Notes" },
  { key: "policy.returns", label: "Returns & Refund Policy Notes" },
  { key: "policy.privacy", label: "Privacy Policy Notes" },
  { key: "policy.terms", label: "Terms of Service Notes" },
  { key: "policy.grievance", label: "Grievance Officer Notes" },
];

export default function ContentAdminClient({
  initialBanners,
  initialContents,
}: {
  initialBanners: BannerItem[];
  initialContents: ContentItem[];
}) {
  const [tab, setTab] = useState<"banners" | "about" | "policies">("banners");
  const [banners, setBanners] = useState<BannerItem[]>(initialBanners);
  const [contents, setContents] = useState<Record<string, ContentItem>>(() => {
    const map: Record<string, ContentItem> = {};
    for (const c of initialContents) {
      map[c.key] = c;
    }
    return map;
  });

  const [newBanner, setNewBanner] = useState({
    imageUrl: "",
    imageAlt: "",
    heading: "",
    subheading: "",
    ctaLabel: "",
    ctaHref: "/shop",
    isActive: true,
    startsAt: "",
    endsAt: "",
  });

  const [uploading, setUploading] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setStatusMsg(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await uploadBannerImageAction(fd);
      setNewBanner((prev) => ({ ...prev, imageUrl: res.url }));
      setStatusMsg({ type: "success", text: "Banner image uploaded." });
    } catch (err) {
      setStatusMsg({ type: "error", text: err instanceof Error ? err.message : "Upload failed." });
    } finally {
      setUploading(false);
    }
  };

  const handleCreateBanner = (e: React.FormEvent) => {
    e.preventDefault();
    setStatusMsg(null);
    startTransition(async () => {
      try {
        const created = await createBannerAction({
          imageUrl: newBanner.imageUrl,
          imageAlt: newBanner.imageAlt,
          heading: newBanner.heading,
          subheading: newBanner.subheading || null,
          ctaLabel: newBanner.ctaLabel || null,
          ctaHref: newBanner.ctaHref || null,
          isActive: newBanner.isActive,
          startsAt: newBanner.startsAt || null,
          endsAt: newBanner.endsAt || null,
        });
        setBanners((prev) => [
          ...prev,
          {
            ...created,
            startsAt: created.startsAt ? created.startsAt.toISOString() : null,
            endsAt: created.endsAt ? created.endsAt.toISOString() : null,
          },
        ]);
        setNewBanner({
          imageUrl: "",
          imageAlt: "",
          heading: "",
          subheading: "",
          ctaLabel: "",
          ctaHref: "/shop",
          isActive: true,
          startsAt: "",
          endsAt: "",
        });
        setStatusMsg({ type: "success", text: "Banner created." });
      } catch (err) {
        setStatusMsg({ type: "error", text: err instanceof Error ? err.message : "Failed to create banner." });
      }
    });
  };

  const handleToggleBanner = (b: BannerItem) => {
    setStatusMsg(null);
    startTransition(async () => {
      try {
        const updated = await updateBannerAction(b.id, { isActive: !b.isActive });
        setBanners((prev) => prev.map((x) => (x.id === b.id ? { ...x, isActive: updated.isActive } : x)));
      } catch (err) {
        setStatusMsg({ type: "error", text: err instanceof Error ? err.message : "Failed to update banner." });
      }
    });
  };

  const handleMoveBanner = (idx: number, dir: -1 | 1) => {
    const targetIdx = idx + dir;
    if (targetIdx < 0 || targetIdx >= banners.length) return;
    const next = [...banners];
    const [moved] = next.splice(idx, 1);
    next.splice(targetIdx, 0, moved);
    setBanners(next);
    startTransition(async () => {
      try {
        await reorderBannersAction(next.map((b) => b.id));
      } catch (err) {
        setStatusMsg({ type: "error", text: err instanceof Error ? err.message : "Failed to reorder." });
      }
    });
  };

  const handleDeleteBanner = (id: string) => {
    setStatusMsg(null);
    startTransition(async () => {
      try {
        await deleteBannerAction(id);
        setBanners((prev) => prev.filter((b) => b.id !== id));
        setStatusMsg({ type: "success", text: "Banner deleted." });
      } catch (err) {
        setStatusMsg({ type: "error", text: err instanceof Error ? err.message : "Failed to delete." });
      }
    });
  };

  const handleSaveContent = (key: string) => {
    const item = contents[key] || { key, title: "", body: "", isPublished: true };
    setStatusMsg(null);
    startTransition(async () => {
      try {
        await saveContentAction({
          key,
          title: item.title,
          body: item.body,
          isPublished: item.isPublished,
        });
        setStatusMsg({ type: "success", text: `Saved "${key}" content.` });
      } catch (err) {
        setStatusMsg({ type: "error", text: err instanceof Error ? err.message : "Failed to save content." });
      }
    });
  };

  const updateContentField = (key: string, patch: Partial<ContentItem>) => {
    setContents((prev) => ({
      ...prev,
      [key]: {
        ...(prev[key] || { key, title: null, body: "", isPublished: true }),
        ...patch,
      },
    }));
  };

  const aboutItem = contents["about"] || { key: "about", title: "", body: "", isPublished: true };

  return (
    <div className="space-y-6">
      {statusMsg && (
        <div
          className={`p-3 text-xs border rounded-sm ${
            statusMsg.type === "success"
              ? "bg-emerald-50 border-emerald-200 text-emerald-800"
              : "bg-red-50 border-red-200 text-red-800"
          }`}
        >
          {statusMsg.text}
        </div>
      )}

      <div className="flex gap-2 border-b border-stone pb-3">
        {(
          [
            { id: "banners", label: "Home Banners" },
            { id: "about", label: "About Page" },
            { id: "policies", label: "Policy Notes" },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`px-4 py-1.5 text-xs font-mono uppercase tracking-wider border ${
              tab === t.id ? "bg-ink text-paper border-ink" : "bg-white text-stone-dark border-stone hover:text-ink"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "banners" && (
        <div className="space-y-8">
          <div className="bg-white border border-stone p-5 space-y-4">
            <h2 className="text-sm font-semibold text-ink uppercase tracking-wider">Existing Banners ({banners.length})</h2>
            {banners.length === 0 && <p className="text-xs text-stone-dark">No banners created yet. The default homepage hero is displayed.</p>}
            <div className="divide-y divide-stone/40">
              {banners.map((b, idx) => (
                <div key={b.id} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={b.imageUrl} alt={b.imageAlt} className="w-20 h-12 object-cover border border-stone bg-paper" />
                    <div className="text-xs">
                      <div className="font-medium text-ink">{b.heading}</div>
                      {b.subheading && <div className="text-stone-dark">{b.subheading}</div>}
                      <div className="text-[11px] font-mono text-stone-dark">
                        {b.isActive ? "ACTIVE" : "INACTIVE"}
                        {b.startsAt ? ` | From ${b.startsAt.slice(0, 10)}` : ""}
                        {b.endsAt ? ` | Until ${b.endsAt.slice(0, 10)}` : ""}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-xs font-mono">
                    <button type="button" onClick={() => handleMoveBanner(idx, -1)} disabled={idx === 0 || isPending} className="px-2 py-1 border border-stone disabled:opacity-40">
                      Up
                    </button>
                    <button type="button" onClick={() => handleMoveBanner(idx, 1)} disabled={idx === banners.length - 1 || isPending} className="px-2 py-1 border border-stone disabled:opacity-40">
                      Down
                    </button>
                    <button type="button" onClick={() => handleToggleBanner(b)} disabled={isPending} className="px-2 py-1 border border-stone">
                      {b.isActive ? "Disable" : "Enable"}
                    </button>
                    <button type="button" onClick={() => handleDeleteBanner(b.id)} disabled={isPending} className="px-2 py-1 border border-red-300 text-red-700">
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <form onSubmit={handleCreateBanner} className="bg-white border border-stone p-5 space-y-4">
            <h2 className="text-sm font-semibold text-ink uppercase tracking-wider">Add New Home Banner</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div>
                <label className="block font-medium mb-1">Upload Banner Image</label>
                <input type="file" accept="image/*" onChange={handleImageUpload} disabled={uploading} className="text-xs" />
                {newBanner.imageUrl && (
                  <div className="mt-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={newBanner.imageUrl} alt="Preview" className="w-40 h-20 object-cover border border-stone" />
                  </div>
                )}
              </div>
              <div>
                <label className="block font-medium mb-1">Image Alt Text *</label>
                <input
                  type="text"
                  required
                  value={newBanner.imageAlt}
                  onChange={(e) => setNewBanner({ ...newBanner, imageAlt: e.target.value })}
                  className="w-full px-3 py-2 border border-stone bg-paper"
                />
              </div>
              <div>
                <label className="block font-medium mb-1">Heading (max 120 chars) *</label>
                <input
                  type="text"
                  required
                  maxLength={120}
                  value={newBanner.heading}
                  onChange={(e) => setNewBanner({ ...newBanner, heading: e.target.value })}
                  className="w-full px-3 py-2 border border-stone bg-paper"
                />
              </div>
              <div>
                <label className="block font-medium mb-1">Subheading</label>
                <input
                  type="text"
                  value={newBanner.subheading}
                  onChange={(e) => setNewBanner({ ...newBanner, subheading: e.target.value })}
                  className="w-full px-3 py-2 border border-stone bg-paper"
                />
              </div>
              <div>
                <label className="block font-medium mb-1">CTA Label</label>
                <input
                  type="text"
                  value={newBanner.ctaLabel}
                  onChange={(e) => setNewBanner({ ...newBanner, ctaLabel: e.target.value })}
                  placeholder="e.g. Shop Collection"
                  className="w-full px-3 py-2 border border-stone bg-paper"
                />
              </div>
              <div>
                <label className="block font-medium mb-1">CTA Link (https:// or /path)</label>
                <input
                  type="text"
                  value={newBanner.ctaHref}
                  onChange={(e) => setNewBanner({ ...newBanner, ctaHref: e.target.value })}
                  className="w-full px-3 py-2 border border-stone bg-paper"
                />
              </div>
              <div>
                <label className="block font-medium mb-1">Starts At (Optional)</label>
                <input
                  type="datetime-local"
                  value={newBanner.startsAt}
                  onChange={(e) => setNewBanner({ ...newBanner, startsAt: e.target.value })}
                  className="w-full px-3 py-2 border border-stone bg-paper"
                />
              </div>
              <div>
                <label className="block font-medium mb-1">Ends At (Optional)</label>
                <input
                  type="datetime-local"
                  value={newBanner.endsAt}
                  onChange={(e) => setNewBanner({ ...newBanner, endsAt: e.target.value })}
                  className="w-full px-3 py-2 border border-stone bg-paper"
                />
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                id="newBannerActive"
                checked={newBanner.isActive}
                onChange={(e) => setNewBanner({ ...newBanner, isActive: e.target.checked })}
              />
              <label htmlFor="newBannerActive">Active (max 8 active banners)</label>
            </div>
            <button
              type="submit"
              disabled={isPending || uploading || !newBanner.imageUrl}
              className="px-5 py-2 bg-moss text-paper text-xs font-mono uppercase tracking-wider disabled:opacity-50"
            >
              {isPending ? "Saving..." : "Create Banner"}
            </button>
          </form>
        </div>
      )}

      {tab === "about" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white border border-stone p-5 space-y-4 text-xs">
            <h2 className="text-sm font-semibold text-ink uppercase tracking-wider">Edit About Page</h2>
            <div>
              <label className="block font-medium mb-1">Page Title</label>
              <input
                type="text"
                value={aboutItem.title || ""}
                onChange={(e) => updateContentField("about", { title: e.target.value })}
                className="w-full px-3 py-2 border border-stone bg-paper"
              />
            </div>
            <div>
              <label className="block font-medium mb-1">Body (supports ## Heading, - Bullet, blank lines)</label>
              <textarea
                rows={12}
                value={aboutItem.body}
                onChange={(e) => updateContentField("about", { body: e.target.value })}
                className="w-full px-3 py-2 border border-stone bg-paper font-mono"
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="aboutPublished"
                checked={aboutItem.isPublished}
                onChange={(e) => updateContentField("about", { isPublished: e.target.checked })}
              />
              <label htmlFor="aboutPublished">Published</label>
            </div>
            <button
              type="button"
              onClick={() => handleSaveContent("about")}
              disabled={isPending}
              className="px-5 py-2 bg-moss text-paper text-xs font-mono uppercase tracking-wider"
            >
              Save About Content
            </button>
          </div>
          <div className="bg-paper border border-stone p-5 space-y-3">
            <div className="text-[11px] font-mono uppercase text-stone-dark">Live Preview (Escaped Text)</div>
            {aboutItem.title && <h3 className="font-display text-2xl text-ink">{aboutItem.title}</h3>}
            <ContentBlocks body={aboutItem.body} />
          </div>
        </div>
      )}

      {tab === "policies" && (
        <div className="space-y-6">
          {POLICY_KEYS.map(({ key, label }) => {
            const item = contents[key] || { key, title: null, body: "", isPublished: true };
            return (
              <div key={key} className="bg-white border border-stone p-5 space-y-3 text-xs">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-ink uppercase tracking-wider">{label}</h3>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={item.isPublished}
                      onChange={(e) => updateContentField(key, { isPublished: e.target.checked })}
                    />
                    <span>Published</span>
                  </label>
                </div>
                <p className="text-stone-dark">Extra notes appended below the generated, settings-driven policy text.</p>
                <textarea
                  rows={4}
                  value={item.body}
                  onChange={(e) => updateContentField(key, { body: e.target.value })}
                  placeholder="Optional extra notes (## Heading, - Bullet)"
                  className="w-full px-3 py-2 border border-stone bg-paper font-mono"
                />
                <button
                  type="button"
                  onClick={() => handleSaveContent(key)}
                  disabled={isPending}
                  className="px-4 py-1.5 bg-moss text-paper text-xs font-mono uppercase tracking-wider"
                >
                  Save {key}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
