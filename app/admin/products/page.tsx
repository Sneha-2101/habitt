import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatINR } from "@/lib/money";
import BulkSkuModal from "./BulkSkuModal";
import { safeErrorSummary } from "@/lib/log-redact";

export const dynamic = "force-dynamic";

export default async function AdminProductsPage() {
  let products: any[] = [];
  try {
    products = await prisma.product.findMany({
      include: { variants: true, images: { take: 1, orderBy: { position: "asc" } }, category: true },
      orderBy: { createdAt: "desc" },
    });
  } catch (err) {
    console.error("AdminProductsPage query error:", safeErrorSummary(err));
  }

  return (
    <main className="px-7 py-9 max-w-5xl mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-7">
        <h1 className="font-display text-2xl font-medium">Products</h1>
        <div className="flex items-center gap-3">
          <Link
            href="/admin/products/import-export"
            className="px-3 py-2 bg-paper border border-stone hover:bg-stone/20 text-xs font-mono uppercase tracking-wider transition-colors"
          >
            Import / Export
          </Link>
          <BulkSkuModal />
          <Link
            href="/admin/products/new"
            className="px-4 py-2 bg-moss text-paper text-[12.5px] tracking-[0.03em] hover:opacity-90 transition-opacity"
          >
            + Add product
          </Link>
        </div>
      </div>

      <div className="border border-stone bg-card">
        <div className="grid grid-cols-[2fr_1fr_1fr_1fr_80px] px-3.5 py-2.5 text-[11px] tracking-[0.06em] text-stone-dark border-b border-stone font-mono uppercase">
          <span>PRODUCT</span>
          <span>CATEGORY</span>
          <span>PRICE</span>
          <span>STOCK</span>
          <span>ACTIONS</span>
        </div>
        {products.map((p) => {
          const totalStock = (p.variants || []).reduce((s: number, v: { stock: number }) => s + v.stock, 0);
          return (
            <div
              key={p.id}
              className="grid grid-cols-[2fr_1fr_1fr_1fr_80px] px-3.5 py-3 text-[13px] items-center border-b border-stone last:border-0 hover:bg-paper/50 transition-colors"
            >
              <span className="flex items-center gap-2.5">
                {p.images[0]?.url ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={p.images[0].url} alt={p.name} className="w-6 h-7 object-cover bg-stone/20" />
                ) : (
                  <span className="w-6 h-7 bg-stone/40 inline-block" />
                )}
                <span className="font-medium">{p.name}</span>
                {p.status === "ACTIVE" && p.publishAt && new Date(p.publishAt) > new Date() && (
                  <span className="ml-2 inline-flex items-center px-1.5 py-0.5 text-[10px] font-mono uppercase bg-amber-100 text-amber-900 border border-amber-300">
                    Scheduled for {new Date(p.publishAt).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </span>
                )}
              </span>
              <span className="text-stone-dark text-[12px]">
                {p.category?.name}
              </span>
              <span className="font-mono text-[12.5px]">{formatINR(p.price)}</span>
              <span className={`font-mono text-[12.5px] ${totalStock < 6 ? "text-clay font-medium" : ""}`}>
                {totalStock}
              </span>
              <span className="flex items-center gap-3">
                <Link
                  href={`/admin/products/${p.id}/edit`}
                  className="text-ink hover:text-moss transition-colors"
                  aria-label="Edit product"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                  </svg>
                </Link>
              </span>
            </div>
          );
        })}
        {products.length === 0 && (
          <p className="px-3.5 py-8 text-sm text-stone-dark text-center">No products found in catalog.</p>
        )}
      </div>
    </main>
  );
}
