import Link from "next/link";
import ImportExportClient from "./ImportExportClient";

export const dynamic = "force-dynamic";

export default function ImportExportPage() {
  return (
    <main className="px-7 py-9 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-mono text-stone-dark mb-1">
            <Link href="/admin/products" className="hover:text-ink">
              Products
            </Link>
            <span>/</span>
            <span>Import & Export</span>
          </div>
          <h1 className="font-display text-2xl font-medium">Catalog Import & Export</h1>
        </div>
      </div>

      <ImportExportClient />
    </main>
  );
}
