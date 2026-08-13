import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import {
  updateProduct,
  updateVariantStock,
  archiveProduct,
  addProductImage,
  deleteProductImage,
} from "@/lib/actions/products";

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params;
  const product = await prisma.product.findUnique({
    where: { id: resolvedParams.id },
    include: { variants: true, images: { orderBy: { position: "asc" } } },
  });
  if (!product) notFound();

  const updateWithId = updateProduct.bind(null, product.id);
  const archiveWithId = archiveProduct.bind(null, product.id);
  const addImageWithId = addProductImage.bind(null, product.id);

  return (
    <main className="px-7 py-9 max-w-lg mx-auto">
      <h1 className="font-display text-2xl mb-7">Edit product</h1>

      <form action={updateWithId} className="flex flex-col gap-3 mb-8">
        <div>
          <label className="block text-[11px] tracking-[0.06em] text-stone-dark mb-1">NAME</label>
          <input name="name" defaultValue={product.name} className="w-full px-3.5 py-3 border border-stone bg-card text-[13.5px]" />
        </div>
        <div>
          <label className="block text-[11px] tracking-[0.06em] text-stone-dark mb-1">CATEGORY</label>
          <select name="category" defaultValue={product.category} className="w-full px-3.5 py-3 border border-stone bg-card text-[13.5px]">
            <option value="SHIRTS">Shirts</option>
            <option value="OVERSHIRTS">Overshirts</option>
            <option value="POLOS">Polos</option>
            <option value="TROUSERS">Trousers</option>
          </select>
        </div>
        <div>
          <label className="block text-[11px] tracking-[0.06em] text-stone-dark mb-1">PRICE (₹)</label>
          <input name="price" type="number" step="0.01" defaultValue={product.price / 100} className="w-full px-3.5 py-3 border border-stone bg-card text-[13.5px]" />
        </div>
        <div>
          <label className="block text-[11px] tracking-[0.06em] text-stone-dark mb-1">DESCRIPTION</label>
          <textarea name="description" defaultValue={product.description} rows={4} className="w-full px-3.5 py-3 border border-stone bg-card text-[13.5px]" />
        </div>
        <div>
          <label className="block text-[11px] tracking-[0.06em] text-stone-dark mb-1">STATUS</label>
          <select name="status" defaultValue={product.status} className="w-full px-3.5 py-3 border border-stone bg-card text-[13.5px]">
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
        {product.variants.map((v) => (
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
