"use client";

import { useState } from "react";
import {
  createCollection,
  updateCollection,
  deleteCollection,
  setCollectionActive,
} from "@/lib/actions/collections";

interface CollectionRow {
  id: string;
  slug: string;
  name: string;
  position: number;
  active: boolean;
  _count: {
    products: number;
    offerTargets: number;
  };
}

export default function CollectionManagerClient({
  collections: initialCollections,
}: {
  collections: CollectionRow[];
}) {
  const [collections, setCollections] = useState(initialCollections);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // New Collection Form state
  const [newSlug, setNewSlug] = useState("");
  const [newName, setNewName] = useState("");
  const [newPosition, setNewPosition] = useState("0");
  const [newActive, setNewActive] = useState(true);

  // Auto-slug from name
  const handleNameChange = (val: string) => {
    setNewName(val);
    if (!newSlug || newSlug === autoSlug(newName)) {
      setNewSlug(autoSlug(val));
    }
  };

  const autoSlug = (str: string) =>
    str
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

  // Editing state per collection
  const [editStates, setEditStates] = useState<
    Record<string, { name: string; position: number }>
  >(() => {
    const map: Record<string, { name: string; position: number }> = {};
    for (const c of initialCollections) {
      map[c.id] = { name: c.name, position: c.position };
    }
    return map;
  });

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsAdding(true);
    try {
      const res = await createCollection({
        slug: newSlug.trim().toLowerCase(),
        name: newName.trim(),
        position: parseInt(newPosition, 10) || 0,
        active: newActive,
      });

      if (res.success && res.collection) {
        const added: CollectionRow = {
          ...res.collection,
          _count: { products: 0, offerTargets: 0 },
        };
        setCollections((prev) =>
          [...prev, added].sort((a, b) => a.position - b.position)
        );
        setEditStates((prev) => ({
          ...prev,
          [added.id]: { name: added.name, position: added.position },
        }));
        setNewName("");
        setNewSlug("");
        setNewPosition("0");
        setNewActive(true);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create collection");
    } finally {
      setIsAdding(false);
    }
  };

  const handleToggleActive = async (id: string, current: boolean) => {
    setError(null);
    setLoadingId(id);
    try {
      await setCollectionActive(id, !current);
      setCollections((prev) =>
        prev.map((c) => (c.id === id ? { ...c, active: !current } : c))
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to toggle status");
    } finally {
      setLoadingId(null);
    }
  };

  const handleSaveEdit = async (id: string) => {
    const state = editStates[id];
    if (!state) return;
    setError(null);
    setLoadingId(id);
    try {
      const res = await updateCollection(id, {
        name: state.name.trim(),
        position: state.position,
      });
      if (res.success && res.collection) {
        setCollections((prev) =>
          prev
            .map((c) =>
              c.id === id
                ? { ...c, name: res.collection.name, position: res.collection.position }
                : c
            )
            .sort((a, b) => a.position - b.position)
        );
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to update collection");
    } finally {
      setLoadingId(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this collection?")) return;
    setError(null);
    setLoadingId(id);
    try {
      await deleteCollection(id);
      setCollections((prev) => prev.filter((c) => c.id !== id));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to delete collection");
    } finally {
      setLoadingId(null);
    }
  };

  return (
    <div className="space-y-8">
      {error && (
        <div className="p-4 bg-red-50 border border-red-200 text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* Collections Table */}
      <div className="bg-card border border-stone overflow-hidden">
        <table className="w-full text-left text-[13px] border-collapse">
          <thead>
            <tr className="border-b border-stone bg-paper text-[11px] tracking-wider uppercase text-stone-dark">
              <th className="py-3 px-4 w-16">Pos</th>
              <th className="py-3 px-4">Name</th>
              <th className="py-3 px-4">Slug</th>
              <th className="py-3 px-4 w-24">Products</th>
              <th className="py-3 px-4 w-24">Status</th>
              <th className="py-3 px-4 text-right w-36">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone">
            {collections.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-6 px-4 text-center text-stone-dark">
                  No collections yet. Create one below.
                </td>
              </tr>
            ) : (
              collections.map((col) => {
                const isBusy = loadingId === col.id;
                const editState = editStates[col.id] || {
                  name: col.name,
                  position: col.position,
                };
                const hasChanged =
                  editState.name !== col.name || editState.position !== col.position;

                return (
                  <tr key={col.id} className="hover:bg-paper/50">
                    <td className="py-3 px-4">
                      <input
                        type="number"
                        className="w-12 h-8 px-2 border border-stone bg-white text-center text-xs"
                        value={editState.position}
                        onChange={(e) =>
                          setEditStates((prev) => ({
                            ...prev,
                            [col.id]: {
                              ...prev[col.id],
                              position: parseInt(e.target.value, 10) || 0,
                            },
                          }))
                        }
                      />
                    </td>
                    <td className="py-3 px-4">
                      <input
                        type="text"
                        className="w-full h-8 px-2 border border-stone bg-white text-xs font-medium"
                        value={editState.name}
                        onChange={(e) =>
                          setEditStates((prev) => ({
                            ...prev,
                            [col.id]: {
                              ...prev[col.id],
                              name: e.target.value,
                            },
                          }))
                        }
                      />
                    </td>
                    <td className="py-3 px-4 text-stone-dark font-mono text-xs">
                      {col.slug}
                    </td>
                    <td className="py-3 px-4 text-stone-dark text-xs">
                      {col._count.products}
                    </td>
                    <td className="py-3 px-4">
                      <button
                        type="button"
                        onClick={() => handleToggleActive(col.id, col.active)}
                        disabled={isBusy}
                        className={`text-xs px-2 py-0.5 font-medium tracking-wide ${
                          col.active
                            ? "bg-green-100 text-green-800 border border-green-200"
                            : "bg-stone-100 text-stone-500 border border-stone-200"
                        }`}
                      >
                        {col.active ? "Active" : "Inactive"}
                      </button>
                    </td>
                    <td className="py-3 px-4 text-right space-x-2">
                      {hasChanged && (
                        <button
                          type="button"
                          onClick={() => handleSaveEdit(col.id)}
                          disabled={isBusy}
                          className="text-xs bg-ink text-white px-2.5 py-1 hover:bg-ink/80 transition-colors"
                        >
                          Save
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleDelete(col.id)}
                        disabled={isBusy}
                        className="text-xs text-red-600 hover:text-red-800 transition-colors px-1 py-1"
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

      {/* Create New Collection Form */}
      <div className="bg-card border border-stone p-6">
        <h2 className="font-display text-lg mb-4">Create Collection</h2>
        <form onSubmit={handleCreate} className="space-y-4 max-w-lg">
          <div>
            <label className="block text-[11px] tracking-[0.06em] text-stone-dark mb-1">
              NAME
            </label>
            <input
              type="text"
              required
              placeholder="e.g. Linen Essentials"
              value={newName}
              onChange={(e) => handleNameChange(e.target.value)}
              className="w-full h-[40px] px-3.5 border border-stone bg-white text-[13px] rounded-none"
            />
          </div>

          <div>
            <label className="block text-[11px] tracking-[0.06em] text-stone-dark mb-1">
              SLUG
            </label>
            <input
              type="text"
              required
              placeholder="e.g. linen-essentials"
              value={newSlug}
              onChange={(e) => setNewSlug(e.target.value)}
              className="w-full h-[40px] px-3.5 border border-stone bg-white text-[13px] font-mono rounded-none"
            />
          </div>

          <div className="flex space-x-4">
            <div className="w-1/2">
              <label className="block text-[11px] tracking-[0.06em] text-stone-dark mb-1">
                POSITION
              </label>
              <input
                type="number"
                value={newPosition}
                onChange={(e) => setNewPosition(e.target.value)}
                className="w-full h-[40px] px-3.5 border border-stone bg-white text-[13px] rounded-none"
              />
            </div>
            <div className="w-1/2 flex items-center pt-5">
              <label className="flex items-center space-x-2 text-xs text-ink cursor-pointer">
                <input
                  type="checkbox"
                  checked={newActive}
                  onChange={(e) => setNewActive(e.target.checked)}
                  className="rounded border-stone text-ink focus:ring-0"
                />
                <span>Active immediately</span>
              </label>
            </div>
          </div>

          <button
            type="submit"
            disabled={isAdding}
            className="w-full h-[44px] bg-ink text-white text-xs uppercase tracking-wider font-medium hover:bg-ink/80 transition-colors disabled:opacity-50"
          >
            {isAdding ? "Creating..." : "Create Collection"}
          </button>
        </form>
      </div>
    </div>
  );
}
