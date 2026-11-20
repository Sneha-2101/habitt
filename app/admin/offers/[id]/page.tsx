import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/guards";
import { prisma } from "@/lib/prisma";
import OfferFormClient, { type ExistingOfferData } from "../OfferFormClient";
import type { OfferKind, OfferAudience } from "@/lib/offers/schema";

export const dynamic = "force-dynamic";

export default async function EditOfferPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireStaff();
  const resolvedParams = await params;

  const offer = await prisma.offer.findUnique({
    where: { id: resolvedParams.id },
    include: {
      targets: {
        select: {
          id: true,
          categoryId: true,
          productId: true,
          collectionId: true,
        },
      },
    },
  });

  if (!offer) {
    notFound();
  }

  const [categories, collections, products, variants] = await Promise.all([
    prisma.category.findMany({
      select: { id: true, name: true, slug: true },
      orderBy: { position: "asc" },
    }),
    prisma.collection.findMany({
      select: { id: true, name: true, slug: true },
      orderBy: { position: "asc" },
    }),
    prisma.product.findMany({
      select: { id: true, name: true, slug: true, price: true },
      orderBy: { name: "asc" },
    }),
    prisma.productVariant.findMany({
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

  const targetsFormatted = offer.targets.map((t) => {
    if (t.categoryId) return { type: "category" as const, id: t.categoryId };
    if (t.productId) return { type: "product" as const, id: t.productId };
    return { type: "collection" as const, id: t.collectionId! };
  });

  const existingOfferData: ExistingOfferData = {
    id: offer.id,
    name: offer.name,
    kind: offer.kind as OfferKind,
    code: offer.code,
    active: offer.active,
    startsAt: offer.startsAt ? offer.startsAt.toISOString() : null,
    endsAt: offer.endsAt ? offer.endsAt.toISOString() : null,
    minCartRupees: offer.minCartPaise / 100,
    maxUsesTotal: offer.maxUsesTotal,
    maxUsesPerCustomer: offer.maxUsesPerCustomer,
    priority: offer.priority,
    audience: offer.audience as OfferAudience,
    config: (offer.config || {}) as Record<string, unknown>,
    targets: targetsFormatted,
  };

  return (
    <main className="px-7 py-9 max-w-4xl mx-auto">
      <div className="mb-7">
        <h1 className="font-display text-2xl font-medium">Edit Offer</h1>
        <p className="text-xs text-stone-dark mt-1">
          Update promotion rules, targets, schedule, or coupon settings.
        </p>
      </div>

      <OfferFormClient
        existingOffer={existingOfferData}
        categories={categories}
        collections={collections}
        products={products}
        variants={variants}
      />
    </main>
  );
}
