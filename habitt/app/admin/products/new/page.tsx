import { createProduct } from "@/lib/actions/products";

export default function NewProductPage() {
  return (
    <main className="px-7 py-9 max-w-lg mx-auto">
      <h1 className="font-display text-2xl mb-7">Add product</h1>
      <form action={createProduct} className="flex flex-col gap-3">
        <div>
          <label className="block text-[11px] tracking-[0.06em] text-stone-dark mb-1">NAME</label>
          <input name="name" placeholder="Name" required className="w-full px-3.5 py-3 border border-stone bg-card text-[13.5px]" />
        </div>
        <div>
          <label className="block text-[11px] tracking-[0.06em] text-stone-dark mb-1">CATEGORY</label>
          <select name="category" className="w-full px-3.5 py-3 border border-stone bg-card text-[13.5px]">
            <option value="SHIRTS">Shirts</option>
            <option value="OVERSHIRTS">Overshirts</option>
            <option value="POLOS">Polos</option>
            <option value="TROUSERS">Trousers</option>
          </select>
        </div>
        <div>
          <label className="block text-[11px] tracking-[0.06em] text-stone-dark mb-1">PRICE (₹)</label>
          <input name="price" type="number" step="0.01" placeholder="Price (₹)" required className="w-full px-3.5 py-3 border border-stone bg-card text-[13.5px]" />
        </div>
        <div>
          <label className="block text-[11px] tracking-[0.06em] text-stone-dark mb-1">INITIAL STOCK PER SIZE</label>
          <input name="stock" type="number" placeholder="Initial stock per size" className="w-full px-3.5 py-3 border border-stone bg-card text-[13.5px]" />
        </div>
        <div>
          <label className="block text-[11px] tracking-[0.06em] text-stone-dark mb-1">DESCRIPTION</label>
          <textarea name="description" placeholder="Description" rows={4} className="w-full px-3.5 py-3 border border-stone bg-card text-[13.5px]" />
        </div>
        <div>
          <label className="block text-[11px] tracking-[0.06em] text-stone-dark mb-1">PRODUCT IMAGES (SUPABASE STORAGE)</label>
          <input
            name="images"
            type="file"
            accept="image/*"
            multiple
            className="w-full px-3.5 py-2.5 border border-stone bg-card text-[12.5px] file:mr-4 file:py-1 file:px-3 file:border-0 file:text-[11.5px] file:bg-stone file:text-ink hover:file:bg-stone-dark/20"
          />
        </div>
        <button type="submit" className="py-3 bg-ink text-paper text-[13px] tracking-[0.04em] mt-3">
          Create product
        </button>
      </form>
    </main>
  );
}
