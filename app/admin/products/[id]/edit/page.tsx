import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getPickerCategories, sortSizes } from "@/lib/catalog/categories";
import { requireStaff } from "@/lib/guards";
import {
  updateProduct,
  updateVariantStock,
  archiveProduct,
  addProductImage,
  deleteProductImage,
} from "@/lib/actions/products";
import {
  nameDefaultColorAction,
  addColorAction,
  renameColorAction,
  removeColorAction,
  setVariantSkuAction,
} from "@/lib/actions/variants";

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireStaff();
  const isOwner = user.role === "OWNER";
  const resolvedParams = await params;
  const product = await prisma.product.findUnique({
    where: { id: resolvedParams.id },
    include: {
      variants: true,
      images: { orderBy: { position: "asc" } },
      category: true,
      collections: { select: { collectionId: true } },
    },
    ...(isOwner ? { omit: { costPrice: false } } : {}),
  });
  if (!product) notFound();

  const allCollections = await prisma.collection.findMany({
    orderBy: { position: "asc" },
    select: { id: true, name: true, slug: true, active: true },
  });
  const assignedCollectionIds = new Set(product.collections.map((c) => c.collectionId));

  const pickerCategories = await getPickerCategories();
  const allCategories = [...pickerCategories];
  if (product.category && !allCategories.some((c) => c.id === product.categoryId)) {
    allCategories.push(product.category);
  }
  allCategories.sort((a, b) => a.position - b.position);

  const usedVariantIds = new Set(
    (
      await prisma.orderItem.findMany({
        where: { variantId: { in: product.variants.map((v) => v.id) } },
        select: { variantId: true },
      })
    ).map((oi) => oi.variantId)
  );

  const colorMap = new Map<
    string,
    {
      color: string;
      colorHex: string | null;
      variants: typeof product.variants;
    }
  >();

  for (const v of product.variants) {
    const cName = v.color || "";
    if (!colorMap.has(cName)) {
      colorMap.set(cName, {
        color: cName,
        colorHex: v.colorHex,
        variants: [],
      });
    }
    const entry = colorMap.get(cName)!;
    if (!entry.colorHex && v.colorHex) entry.colorHex = v.colorHex;
    entry.variants.push(v);
  }

  const categorySizes = product.category?.sizes ?? [];
  const colorGroups = Array.from(colorMap.values()).map((cg) => {
    const orderedSizes = sortSizes(
      cg.variants.map((v) => v.size),
      categorySizes
    );
    const sizeRank = new Map(orderedSizes.map((sz, idx) => [sz, idx]));
    const sorted = [...cg.variants].sort(
      (a, b) => (sizeRank.get(a.size) ?? 999) - (sizeRank.get(b.size) ?? 999)
    );
    return {
      ...cg,
      variants: sorted,
    };
  });

  const isOnlyColor = colorGroups.length <= 1;
  const hasOnlyNoColor =
    product.variants.length > 0 && product.variants.every((v) => v.color === "");
  const hasNamedColors =
    product.variants.length > 0 && product.variants.every((v) => v.color !== "");

  const updateWithId = updateProduct.bind(null, product.id);
  const archiveWithId = archiveProduct.bind(null, product.id);
  const addImageWithId = addProductImage.bind(null, product.id);

  return (
    <main className="px-7 py-9 max-w-lg mx-auto">
      <h1 className="font-display text-2xl mb-7">Edit product</h1>

      <form action={updateWithId} className="flex flex-col gap-4 mb-8">
        <div>
          <label className="block text-[11px] tracking-[0.06em] text-stone-dark mb-1">NAME</label>
          <input
            name="name"
            defaultValue={product.name}
            required
            className="w-full h-[44px] px-3.5 py-3 border border-stone bg-card text-[13.5px] rounded-none"
          />
        </div>
        <div>
          <label className="block text-[11px] tracking-[0.06em] text-stone-dark mb-1">CATEGORY</label>
          <select
            name="categoryId"
            defaultValue={product.categoryId}
            className="w-full h-[44px] px-3.5 py-3 border border-stone bg-card text-[13.5px] rounded-none"
          >
            {allCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}{!c.active ? " (Inactive)" : ""}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[11px] tracking-[0.06em] text-stone-dark mb-1">COLLECTIONS</label>
          <input type="hidden" name="hasCollections" value="1" />
          <div className="border border-stone bg-card p-3 max-h-48 overflow-y-auto space-y-2">
            {allCollections.length === 0 ? (
              <p className="text-xs text-stone-dark">No collections created yet.</p>
            ) : (
              allCollections.map((col) => (
                <label key={col.id} className="flex items-center space-x-2 text-xs text-ink cursor-pointer">
                  <input
                    type="checkbox"
                    name="collectionIds"
                    value={col.id}
                    defaultChecked={assignedCollectionIds.has(col.id)}
                    className="rounded border-stone text-ink focus:ring-0"
                  />
                  <span>
                    {col.name} {!col.active && <span className="text-stone-dark">(Inactive)</span>}
                  </span>
                </label>
              ))
            )}
          </div>
        </div>
        <div>
          <label className="block text-[11px] tracking-[0.06em] text-stone-dark mb-1">PRICE (₹)</label>
          <input
            name="price"
            type="number"
            step="0.01"
            inputMode="decimal"
            defaultValue={product.price / 100}
            required
            className="w-full h-[44px] px-3.5 py-3 border border-stone bg-card text-[13.5px] rounded-none"
          />
        </div>
        <div>
          <label className="block text-[11px] tracking-[0.06em] text-stone-dark mb-1">COMPARE-AT PRICE (₹)</label>
          <input
            name="compareAtRupees"
            type="number"
            step="0.01"
            inputMode="decimal"
            defaultValue={
              product.compareAtPrice !== null && product.compareAtPrice !== undefined
                ? product.compareAtPrice / 100
                : ""
            }
            placeholder="Compare-at price (₹)"
            className="w-full h-[44px] px-3.5 py-3 border border-stone bg-card text-[13.5px] rounded-none"
          />
          <p className="text-[11px] text-stone-dark mt-1">
            Only set this if the item was genuinely sold at this price (consumer-protection rule)
          </p>
        </div>
        {isOwner && (
          <div>
            <label className="block text-[11px] tracking-[0.06em] text-stone-dark mb-1">COST PRICE (₹)</label>
            <input
              name="costRupees"
              type="number"
              step="0.01"
              inputMode="decimal"
              defaultValue={
                "costPrice" in product && typeof product.costPrice === "number"
                  ? product.costPrice / 100
                  : ""
              }
              placeholder="Cost price (₹) — Owner only"
              className="w-full h-[44px] px-3.5 py-3 border border-stone bg-card text-[13.5px] rounded-none"
            />
          </div>
        )}
        <div>
          <label className="block text-[11px] tracking-[0.06em] text-stone-dark mb-1">HSN CODE</label>
          <input
            name="hsn"
            inputMode="numeric"
            defaultValue={product.hsn ?? ""}
            placeholder="e.g. 6205 (4, 6, or 8 digits)"
            className="w-full h-[44px] px-3.5 py-3 border border-stone bg-card text-[13.5px] rounded-none"
          />
        </div>
        <div>
          <label className="block text-[11px] tracking-[0.06em] text-stone-dark mb-1">FABRIC</label>
          <input
            name="fabric"
            defaultValue={product.fabric ?? ""}
            placeholder="Fabric composition (e.g. 100% Linen)"
            className="w-full h-[44px] px-3.5 py-3 border border-stone bg-card text-[13.5px] rounded-none"
          />
        </div>
        <div>
          <label className="block text-[11px] tracking-[0.06em] text-stone-dark mb-1">FIT</label>
          <input
            name="fit"
            defaultValue={product.fit ?? ""}
            placeholder="Fit description (e.g. Regular, Relaxed)"
            className="w-full h-[44px] px-3.5 py-3 border border-stone bg-card text-[13.5px] rounded-none"
          />
        </div>
        <div>
          <label className="block text-[11px] tracking-[0.06em] text-stone-dark mb-1">CARE INSTRUCTIONS</label>
          <textarea
            name="care"
            defaultValue={product.care ?? ""}
            placeholder="Care instructions"
            rows={3}
            className="w-full px-3.5 py-3 border border-stone bg-card text-[13.5px] rounded-none"
          />
        </div>
        <div>
          <label className="block text-[11px] tracking-[0.06em] text-stone-dark mb-1">SIZE CHART LINK</label>
          <input
            name="sizeChartUrl"
            type="url"
            inputMode="url"
            defaultValue={product.sizeChartUrl ?? ""}
            placeholder="https://... or /charts/..."
            className="w-full h-[44px] px-3.5 py-3 border border-stone bg-card text-[13.5px] rounded-none"
          />
        </div>
        <div>
          <label className="block text-[11px] tracking-[0.06em] text-stone-dark mb-1">SEO TITLE</label>
          <input
            name="seoTitle"
            maxLength={70}
            defaultValue={product.seoTitle ?? ""}
            placeholder="SEO title (max 70 chars)"
            className="w-full h-[44px] px-3.5 py-3 border border-stone bg-card text-[13.5px] rounded-none"
          />
        </div>
        <div>
          <label className="block text-[11px] tracking-[0.06em] text-stone-dark mb-1">SEO DESCRIPTION</label>
          <textarea
            name="seoDescription"
            maxLength={160}
            defaultValue={product.seoDescription ?? ""}
            placeholder="SEO description (max 160 chars)"
            rows={3}
            className="w-full px-3.5 py-3 border border-stone bg-card text-[13.5px] rounded-none"
          />
        </div>
        <div>
          <label className="block text-[11px] tracking-[0.06em] text-stone-dark mb-1">DESCRIPTION</label>
          <textarea
            name="description"
            defaultValue={product.description}
            rows={4}
            className="w-full px-3.5 py-3 border border-stone bg-card text-[13.5px] rounded-none"
          />
        </div>
        <div>
          <label className="block text-[11px] tracking-[0.06em] text-stone-dark mb-1">STATUS</label>
          <select
            name="status"
            defaultValue={product.status}
            className="w-full h-[44px] px-3.5 py-3 border border-stone bg-card text-[13.5px] rounded-none"
          >
            <option value="DRAFT">Draft</option>
            <option value="ACTIVE">Active</option>
            <option value="ARCHIVED">Archived</option>
          </select>
        </div>
        <button type="submit" className="py-3 bg-ink text-paper text-[13px] tracking-[0.04em] mt-2">
          Save changes
        </button>
      </form>

      {/* PRODUCT IMAGES SECTION */}
      <div className="mb-8">
        <h2 className="text-sm font-medium mb-3">Product Images (Supabase Storage)</h2>
        {product.images.length > 0 ? (
          <div className="grid grid-cols-3 gap-3 mb-4">
            {product.images.map((img) => (
              <div key={img.id} className="relative group border border-stone p-2 bg-card">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.url} alt="Product image" className="w-full h-24 object-cover mb-2" />
                <form
                  action={async () => {
                    "use server";
                    await deleteProductImage(img.id, product.id);
                  }}
                >
                  <button type="submit" className="w-full py-1 bg-stone/50 hover:bg-clay hover:text-white text-ink text-[11px] transition-colors">
                    Delete
                  </button>
                </form>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[12.5px] text-stone-dark mb-4">No images uploaded yet.</p>
        )}

        <form action={addImageWithId} className="flex gap-2 items-center">
          <input
            name="image"
            type="file"
            accept="image/*"
            required
            className="flex-1 px-3 py-2 border border-stone text-[12px] file:mr-2 file:py-1 file:px-2 file:border-0 file:text-[11px] file:bg-stone"
          />
          <button type="submit" className="px-4 py-2.5 bg-ink text-paper text-[12px]">
            Upload image
          </button>
        </form>
      </div>

      {/* "NAME THIS COLOR" FORM (ONLY WHEN PRODUCT HAS ONLY NO-COLOR VARIANTS) */}
      {hasOnlyNoColor && (
        <div className="border border-stone p-4 bg-card mb-8">
          <h2 className="text-sm font-medium mb-1">Name this color</h2>
          <p className="text-[12px] text-stone-dark mb-3">
            This product currently has no color specified. Name the default color to enable color variants.
          </p>
          <form
            action={async (formData: FormData) => {
              "use server";
              await nameDefaultColorAction(
                product.id,
                formData.get("name") as string,
                (formData.get("hex") as string) || null
              );
            }}
            className="flex flex-col sm:flex-row gap-2"
          >
            <input
              name="name"
              type="text"
              required
              placeholder="Color name (e.g. Navy)"
              className="h-[44px] px-3.5 border border-stone bg-white text-[13.5px] rounded-none flex-1"
            />
            <input
              name="hex"
              type="text"
              placeholder="#RRGGBB (optional)"
              className="h-[44px] w-full sm:w-36 px-3.5 border border-stone bg-white text-[13.5px] rounded-none"
            />
            <button
              type="submit"
              className="h-[44px] px-5 bg-ink text-paper text-[12px] font-medium tracking-[0.04em] rounded-none"
            >
              Name color
            </button>
          </form>
        </div>
      )}

      {/* VARIANTS BY COLOR SECTION */}
      <h2 className="text-sm font-medium mb-3">Variants & Stock by Color</h2>
      <div className="space-y-6 mb-8">
        {colorGroups.map((cg) => {
          const hasOrders = cg.variants.some((v) => usedVariantIds.has(v.id));
          const cannotRemoveReason = isOnlyColor
            ? "Cannot remove the only color"
            : hasOrders
            ? "Referenced by existing orders"
            : null;

          return (
            <div key={cg.color || "__no_color"} className="border border-stone bg-card">
              {/* Color Header & Management */}
              <div className="p-4 border-b border-stone bg-paper/50 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {cg.colorHex && (
                      <span
                        className="inline-block w-4 h-4 border border-stone"
                        style={{ backgroundColor: cg.colorHex }}
                      />
                    )}
                    <span className="font-medium text-[14px]">
                      {cg.color === "" ? "No color" : cg.color}
                    </span>
                    {cg.colorHex && (
                      <span className="text-[11px] font-mono text-stone-dark">({cg.colorHex})</span>
                    )}
                  </div>
                  <form
                    action={async () => {
                      "use server";
                      await removeColorAction(product.id, cg.color);
                    }}
                  >
                    <button
                      type="submit"
                      disabled={!!cannotRemoveReason}
                      title={cannotRemoveReason ?? undefined}
                      className="h-[44px] px-2 text-clay hover:opacity-80 text-[12px] underline disabled:opacity-40 disabled:no-underline disabled:cursor-not-allowed"
                    >
                      Remove color{cannotRemoveReason ? ` (${cannotRemoveReason})` : ""}
                    </button>
                  </form>
                </div>

                {/* Rename Color Form */}
                <form
                  action={async (formData: FormData) => {
                    "use server";
                    await renameColorAction(
                      product.id,
                      cg.color,
                      formData.get("name") as string,
                      (formData.get("hex") as string) || null
                    );
                  }}
                  className="flex flex-col sm:flex-row gap-2 pt-1 border-t border-stone/40"
                >
                  <input
                    name="name"
                    type="text"
                    defaultValue={cg.color}
                    required
                    placeholder="Color name"
                    className="h-[44px] px-3 border border-stone bg-white text-[13px] rounded-none flex-1"
                  />
                  <input
                    name="hex"
                    type="text"
                    defaultValue={cg.colorHex ?? ""}
                    placeholder="#RRGGBB"
                    className="h-[44px] w-full sm:w-32 px-3 border border-stone bg-white text-[13px] rounded-none"
                  />
                  <button
                    type="submit"
                    className="h-[44px] px-4 bg-stone/30 hover:bg-stone/50 text-[12px] font-medium tracking-[0.04em] rounded-none"
                  >
                    Rename
                  </button>
                </form>
              </div>

              {/* Variant Rows (Sizes & Stock & SKU) */}
              <div className="divide-y divide-stone">
                {cg.variants.map((v) => (
                  <div
                    key={v.id}
                    className="p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-[13px] bg-white"
                  >
                    <span className="font-mono font-medium text-[14px] w-12">{v.size}</span>
                    <div className="flex flex-wrap items-center gap-4">
                      {/* Existing stock form */}
                      <form
                        action={async (formData: FormData) => {
                          "use server";
                          await updateVariantStock(v.id, Number(formData.get("stock")));
                        }}
                        className="flex items-center gap-1.5"
                      >
                        <label className="text-[11px] text-stone-dark">Stock:</label>
                        <input
                          name="stock"
                          type="number"
                          defaultValue={v.stock}
                          className="w-16 h-[44px] px-2 py-1 border border-stone text-[13px] rounded-none text-center"
                        />
                        <button type="submit" className="h-[44px] px-2 text-[11.5px] underline">
                          Update
                        </button>
                      </form>

                      {/* Optional SKU form */}
                      <form
                        action={async (formData: FormData) => {
                          "use server";
                          await setVariantSkuAction(v.id, (formData.get("sku") as string) || null);
                        }}
                        className="flex items-center gap-1.5"
                      >
                        <label className="text-[11px] text-stone-dark">SKU:</label>
                        <input
                          name="sku"
                          type="text"
                          defaultValue={v.sku ?? ""}
                          placeholder="Optional SKU"
                          className="w-28 h-[44px] px-2 py-1 border border-stone text-[12px] font-mono uppercase rounded-none"
                        />
                        <button type="submit" className="h-[44px] px-2 text-[11.5px] underline">
                          Save SKU
                        </button>
                      </form>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* "ADD ANOTHER COLOR" FORM (ONLY WHEN PRODUCT ALREADY HAS NAMED COLORS) */}
      {hasNamedColors && (
        <div className="border border-stone p-4 bg-card mb-8">
          <h2 className="text-sm font-medium mb-1">Add another color</h2>
          <p className="text-[12px] text-stone-dark mb-3">
            Add a new color variation with initial stock across all sizes.
          </p>
          <form
            action={async (formData: FormData) => {
              "use server";
              await addColorAction(
                product.id,
                formData.get("name") as string,
                (formData.get("hex") as string) || null,
                Number(formData.get("stock") || 0)
              );
            }}
            className="flex flex-col sm:flex-row gap-2"
          >
            <input
              name="name"
              type="text"
              required
              placeholder="Color name (e.g. Olive)"
              className="h-[44px] px-3.5 border border-stone bg-white text-[13.5px] rounded-none flex-1"
            />
            <input
              name="hex"
              type="text"
              placeholder="#RRGGBB (optional)"
              className="h-[44px] w-full sm:w-36 px-3.5 border border-stone bg-white text-[13.5px] rounded-none"
            />
            <input
              name="stock"
              type="number"
              min="0"
              defaultValue="0"
              placeholder="Initial stock"
              className="h-[44px] w-full sm:w-28 px-3.5 border border-stone bg-white text-[13.5px] rounded-none"
            />
            <button
              type="submit"
              className="h-[44px] px-5 bg-ink text-paper text-[12px] font-medium tracking-[0.04em] rounded-none"
            >
              Add color
            </button>
          </form>
        </div>
      )}

      <form action={archiveWithId}>
        <button type="submit" className="text-clay text-[12.5px] underline">
          Archive this product
        </button>
      </form>
    </main>
  );
}
