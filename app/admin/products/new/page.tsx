import { createProduct } from "@/lib/actions/products";
import { getPickerCategories } from "@/lib/catalog/categories";
import { requireStaff } from "@/lib/guards";
import { SeoFieldsWithCounter } from "@/components/admin/SeoFieldsWithCounter";

export default async function NewProductPage() {
  const user = await requireStaff();
  const isOwner = user.role === "OWNER";
  const categories = await getPickerCategories();

  return (
    <main className="px-7 py-9 max-w-lg mx-auto">
      <h1 className="font-display text-2xl mb-7">Add product</h1>
      <form action={createProduct} className="flex flex-col gap-4">
        <div>
          <label className="block text-[11px] tracking-[0.06em] text-stone-dark mb-1">NAME</label>
          <input
            name="name"
            placeholder="Name"
            required
            className="w-full h-[44px] px-3.5 py-3 border border-stone bg-card text-[13.5px] rounded-none"
          />
        </div>
        <div>
          <label className="block text-[11px] tracking-[0.06em] text-stone-dark mb-1">CATEGORY</label>
          <select
            name="categoryId"
            className="w-full h-[44px] px-3.5 py-3 border border-stone bg-card text-[13.5px] rounded-none"
          >
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
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
            placeholder="Price (₹)"
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
            placeholder="e.g. 6205 (4, 6, or 8 digits)"
            className="w-full h-[44px] px-3.5 py-3 border border-stone bg-card text-[13.5px] rounded-none"
          />
        </div>
        <div>
          <label className="block text-[11px] tracking-[0.06em] text-stone-dark mb-1">FABRIC</label>
          <input
            name="fabric"
            placeholder="Fabric composition (e.g. 100% Linen)"
            className="w-full h-[44px] px-3.5 py-3 border border-stone bg-card text-[13.5px] rounded-none"
          />
        </div>
        <div>
          <label className="block text-[11px] tracking-[0.06em] text-stone-dark mb-1">FIT</label>
          <input
            name="fit"
            placeholder="Fit description (e.g. Regular, Relaxed)"
            className="w-full h-[44px] px-3.5 py-3 border border-stone bg-card text-[13.5px] rounded-none"
          />
        </div>
        <div>
          <label className="block text-[11px] tracking-[0.06em] text-stone-dark mb-1">CARE INSTRUCTIONS</label>
          <textarea
            name="care"
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
            placeholder="https://... or /charts/..."
            className="w-full h-[44px] px-3.5 py-3 border border-stone bg-card text-[13.5px] rounded-none"
          />
        </div>
        <SeoFieldsWithCounter />
        <div>
          <label className="block text-[11px] tracking-[0.06em] text-stone-dark mb-1">INITIAL STOCK PER SIZE</label>
          <input
            name="stock"
            type="number"
            placeholder="Initial stock per size"
            className="w-full h-[44px] px-3.5 py-3 border border-stone bg-card text-[13.5px] rounded-none"
          />
        </div>
        <div>
          <label className="block text-[11px] tracking-[0.06em] text-stone-dark mb-1">
            PUBLISH DATE &amp; TIME (IST)
          </label>
          <input
            name="publishAt"
            type="datetime-local"
            className="w-full h-[44px] px-3.5 py-3 border border-stone bg-card text-[13.5px] rounded-none"
          />
          <p className="text-[11px] text-stone-dark mt-1">Leave empty to publish immediately once active.</p>
        </div>
        <div>
          <label className="block text-[11px] tracking-[0.06em] text-stone-dark mb-1">DESCRIPTION</label>
          <textarea
            name="description"
            placeholder="Description"
            rows={4}
            className="w-full px-3.5 py-3 border border-stone bg-card text-[13.5px] rounded-none"
          />
        </div>
        <div>
          <label className="block text-[11px] tracking-[0.06em] text-stone-dark mb-1">PRODUCT IMAGES (SUPABASE STORAGE)</label>
          <input
            name="images"
            type="file"
            accept="image/*"
            multiple
            className="w-full px-3.5 py-2.5 border border-stone bg-card text-[12.5px] file:mr-4 file:py-1 file:px-3 file:border-0 file:text-[11.5px] file:bg-stone file:text-ink hover:file:bg-stone-dark/20 rounded-none"
          />
        </div>
        <button type="submit" className="py-3 bg-ink text-paper text-[13px] tracking-[0.04em] mt-3">
          Create product
        </button>
      </form>
    </main>
  );
}
