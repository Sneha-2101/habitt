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

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireStaff();
  const isOwner = user.role === "OWNER";
  const resolvedParams = await params;
  const product = await prisma.product.findUnique({
    where: { id: resolvedParams.id },
    include: { variants: true, images: { orderBy: { position: "asc" } }, category: true },
    ...(isOwner ? { omit: { costPrice: false } } : {}),
  });
  if (!product) notFound();

  const pickerCategories = await getPickerCategories();
  const allCategories = [...pickerCategories];
  if (product.category && !allCategories.some((c) => c.id === product.categoryId)) {
    allCategories.push(product.category);
  }
  allCategories.sort((a, b) => a.position - b.position);

  const orderedSizes = sortSizes(
    product.variants.map((v) => v.size),
    product.category?.sizes ?? []
  );
  const sizeRank = new Map(orderedSizes.map((sz, idx) => [sz, idx]));
  const sortedVariants = [...product.variants].sort(
    (a, b) => (sizeRank.get(a.size) ?? 999) - (sizeRank.get(b.size) ?? 999)
  );

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

      {/* STOCK BY SIZE SECTION */}
      <h2 className="text-sm font-medium mb-3">Stock by size</h2>
      <div className="border border-stone mb-8">
        {sortedVariants.map((v) => (
          <form
            key={v.id}
            action={async (formData: FormData) => {
              "use server";
              await updateVariantStock(v.id, Number(formData.get("stock")));
            }}
            className="flex justify-between items-center px-4 py-2.5 border-b border-stone last:border-0 text-[13px]"
          >
            <span>{v.size}</span>
            <div className="flex items-center gap-2">
              <input name="stock" type="number" defaultValue={v.stock} className="w-16 px-2 py-1 border border-stone text-[13px]" />
              <button type="submit" className="text-[11.5px] underline">Update</button>
            </div>
          </form>
        ))}
      </div>

      <form action={archiveWithId}>
        <button type="submit" className="text-clay text-[12.5px] underline">
          Archive this product
        </button>
      </form>
    </main>
  );
}
