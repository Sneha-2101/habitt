"use client";

import { useState } from "react";
import { createCategoryAction, updateCategoryAction, deleteCategoryAction } from "@/lib/actions/categories";

interface CategoryWithCount {
  id: string;
  slug: string;
  name: string;
  position: number;
  sizes: string[];
  active: boolean;
  _count: {
    products: number;
  };
}

export default function CategoryManagerClient({
  categories: initialCategories,
}: {
  categories: CategoryWithCount[];
}) {
  const [categories, setCategories] = useState(initialCategories);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // New Category form state
  const [newSlug, setNewSlug] = useState("");
  const [newName, setNewName] = useState("");
  const [newPosition, setNewPosition] = useState("0");
  const [newSizes, setNewSizes] = useState("S, M, L, XL, XXL");
  const [newActive, setNewActive] = useState(true);

  // Editing state per category
  const [editStates, setEditStates] = useState<Record<string, {
    name: string;
    position: number;
    sizes: string;
    active: boolean;
  }>>(() => {
    const map: Record<string, { name: string; position: number; sizes: string; active: boolean }> = {};
    for (const c of initialCategories) {
      map[c.id] = {
        name: c.name,
        position: c.position,
        sizes: c.sizes.join(", "),
        active: c.active,
      };
    }
    return map;
  });

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsAdding(true);
    try {
      const res = await createCategoryAction({
        slug: newSlug.trim().toLowerCase(),
        name: newName.trim(),
        position: parseInt(newPosition, 10) || 0,
        sizes: newSizes.split(",").map((s) => s.trim()).filter(Boolean),
        active: newActive,
      });
      if (res?.category) {
        setCategories((prev) => [...prev, { ...res.category, _count: { products: 0 } }].sort((a, b) => a.position - b.position));
        setNewSlug("");
        setNewName("");
        setNewPosition("0");
        setNewSizes("S, M, L, XL, XXL");
        setNewActive(true);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create category");
    } finally {
      setIsAdding(false);
    }
  };

  const handleUpdate = async (id: string) => {
    const edit = editStates[id];
    if (!edit) return;
    setError(null);
    setLoadingId(id);
    try {
      const res = await updateCategoryAction(id, {
        name: edit.name.trim(),
        position: edit.position,
        sizes: edit.sizes.split(",").map((s) => s.trim()).filter(Boolean),
        active: edit.active,
      });
      if (res?.category) {
        setCategories((prev) =>
          prev.map((c) => (c.id === id ? { ...c, ...res.category } : c)).sort((a, b) => a.position - b.position)
        );
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to update category");
    } finally {
      setLoadingId(null);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Are you sure you want to delete category "${name}"?`)) return;
    setError(null);
    setLoadingId(id);
    try {
      await deleteCategoryAction(id);
      setCategories((prev) => prev.filter((c) => c.id !== id));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to delete category");
    } finally {
      setLoadingId(null);
    }
  };

  return (
    <div className="space-y-8">
      {error && (
        <div className="p-3.5 bg-clay/10 border border-clay text-clay text-xs tracking-wide">
          {error}
        </div>
      )}

      {/* Categories List */}
      <div className="border border-stone bg-card">
        <div className="px-4 py-3 border-b border-stone text-xs tracking-wider uppercase font-mono text-stone-dark">
          Categories ({categories.length})
        </div>

        <div className="divide-y divide-stone">
          {categories.map((cat) => {
            const edit = editStates[cat.id] ?? {
              name: cat.name,
              position: cat.position,
              sizes: cat.sizes.join(", "),
              active: cat.active,
            };
            const hasProducts = cat._count.products > 0;
            const isLoading = loadingId === cat.id;

            return (
              <div key={cat.id} className="p-4 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-xs text-stone-dark w-6">#{cat.position}</span>
                    <input
                      type="text"
                      value={edit.name}
                      onChange={(e) =>
                        setEditStates((prev) => ({
                          ...prev,
                          [cat.id]: { ...edit, name: e.target.value },
                        }))
                      }
                      className="px-2.5 py-1.5 border border-stone bg-paper text-sm text-ink font-medium max-w-xs"
                      placeholder="Category name"
                    />
                    <span className="font-mono text-xs text-stone-dark">slug: {cat.slug}</span>
                  </div>

                  <div className="flex items-center gap-3 text-xs">
                    <span className="font-mono text-stone-dark">
                      {cat._count.products} product{cat._count.products === 1 ? "" : "s"}
                    </span>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={edit.active}
                        onChange={(e) =>
                          setEditStates((prev) => ({
                            ...prev,
                            [cat.id]: { ...edit, active: e.target.checked },
                          }))
                        }
                        className="rounded-none border-stone text-ink focus:ring-0"
                      />
                      <span className="font-mono uppercase">{edit.active ? "Active" : "Inactive"}</span>
                    </label>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-[1fr_80px_auto] gap-3 items-center">
                  <div>
                    <label className="block text-[10.5px] uppercase tracking-wider font-mono text-stone-dark mb-1">
                      Sizes (comma-separated)
                    </label>
                    <input
                      type="text"
                      value={edit.sizes}
                      onChange={(e) =>
                        setEditStates((prev) => ({
                          ...prev,
                          [cat.id]: { ...edit, sizes: e.target.value },
                        }))
                      }
                      className="w-full px-2.5 py-1.5 border border-stone bg-paper text-xs font-mono"
                      placeholder="S, M, L, XL, XXL"
                    />
                  </div>

                  <div>
                    <label className="block text-[10.5px] uppercase tracking-wider font-mono text-stone-dark mb-1">
                      Position
                    </label>
                    <input
                      type="number"
                      value={edit.position}
                      onChange={(e) =>
                        setEditStates((prev) => ({
                          ...prev,
                          [cat.id]: { ...edit, position: parseInt(e.target.value, 10) || 0 },
                        }))
                      }
                      className="w-full px-2.5 py-1.5 border border-stone bg-paper text-xs font-mono"
                    />
                  </div>

                  <div className="flex items-end gap-2 pt-4 sm:pt-0">
                    <button
                      type="button"
                      onClick={() => handleUpdate(cat.id)}
                      disabled={isLoading}
                      className="px-3.5 py-1.5 bg-ink text-paper text-xs font-medium uppercase tracking-wider hover:opacity-90 disabled:opacity-50"
                    >
                      {isLoading ? "Saving..." : "Save"}
                    </button>

                    <button
                      type="button"
                      onClick={() => handleDelete(cat.id, cat.name)}
                      disabled={isLoading || hasProducts}
                      title={hasProducts ? `Cannot delete: ${cat._count.products} product(s) reference this category` : "Delete category"}
                      className="px-3 py-1.5 border border-clay text-clay text-xs font-medium uppercase tracking-wider hover:bg-clay/10 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Add Category Form */}
      <div className="border border-stone bg-card p-5">
        <h2 className="font-display text-lg text-ink font-medium mb-4">Add Category</h2>
        <form onSubmit={handleCreate} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-[11px] font-mono uppercase tracking-wider text-stone-dark mb-1">
                Name *
              </label>
              <input
                type="text"
                required
                value={newName}
                onChange={(e) => {
                  setNewName(e.target.value);
                  if (!newSlug) {
                    setNewSlug(e.target.value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""));
                  }
                }}
                className="w-full px-3 py-2 border border-stone bg-paper text-sm"
                placeholder="e.g. Knitwear"
              />
            </div>

            <div>
              <label className="block text-[11px] font-mono uppercase tracking-wider text-stone-dark mb-1">
                Slug * (immutable, lowercase/hyphens)
              </label>
              <input
                type="text"
                required
                value={newSlug}
                onChange={(e) => setNewSlug(e.target.value)}
                className="w-full px-3 py-2 border border-stone bg-paper text-sm font-mono"
                placeholder="e.g. knitwear"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-[1fr_100px_auto] gap-4 items-end">
            <div>
              <label className="block text-[11px] font-mono uppercase tracking-wider text-stone-dark mb-1">
                Sizes (comma-separated) *
              </label>
              <input
                type="text"
                required
                value={newSizes}
                onChange={(e) => setNewSizes(e.target.value)}
                className="w-full px-3 py-2 border border-stone bg-paper text-sm font-mono"
                placeholder="S, M, L, XL, XXL"
              />
            </div>

            <div>
              <label className="block text-[11px] font-mono uppercase tracking-wider text-stone-dark mb-1">
                Position
              </label>
              <input
                type="number"
                value={newPosition}
                onChange={(e) => setNewPosition(e.target.value)}
                className="w-full px-3 py-2 border border-stone bg-paper text-sm font-mono"
              />
            </div>

            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 cursor-pointer pb-2">
                <input
                  type="checkbox"
                  checked={newActive}
                  onChange={(e) => setNewActive(e.target.checked)}
                  className="rounded-none border-stone text-ink focus:ring-0"
                />
                <span className="text-xs font-mono uppercase">Active</span>
              </label>

              <button
                type="submit"
                disabled={isAdding}
                className="px-5 py-2.5 bg-moss text-paper text-xs font-medium uppercase tracking-wider hover:opacity-90 disabled:opacity-50"
              >
                {isAdding ? "Adding..." : "+ Add Category"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
