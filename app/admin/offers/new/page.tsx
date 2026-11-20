import { requireStaff } from "@/lib/guards";
import { prisma } from "@/lib/prisma";
import OfferFormClient from "../OfferFormClient";

export const dynamic = "force-dynamic";

export default async function NewOfferPage() {
  await requireStaff();

  const [categories, collections, products, variants] = await Promise.all([
    prisma.category.findMany({
      where: { active: true },
      select: { id: true, name: true, slug: true },
      orderBy: { position: "asc" },
    }),
    prisma.collection.findMany({
      where: { active: true },
      select: { id: true, name: true, slug: true },
      orderBy: { position: "asc" },
    }),
    prisma.product.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, name: true, slug: true, price: true },
      orderBy: { name: "asc" },
    }),
    prisma.productVariant.findMany({
      where: { product: { status: "ACTIVE" } },
      select: {
        id: true,
        size: true,
        color: true,
        sku: true,
        stock: true,
        product: { select: { id: true, name: true } },
      },
      orderBy: [{ product: { name: "asc" } }, { size: "asc" }],
    }),
  ]);

  return (
    <main className="px-7 py-9 max-w-4xl mx-auto">
      <div className="mb-7">
        <h1 className="font-display text-2xl font-medium">Create New Offer</h1>
        <p className="text-xs text-stone-dark mt-1">
          Configure an automatic discount, tiered pricing, bundle, gift with purchase, or coupon code.
        </p>
      </div>

      <OfferFormClient
        categories={categories}
        collections={collections}
        products={products}
        variants={variants}
      />
    </main>
  );
}
