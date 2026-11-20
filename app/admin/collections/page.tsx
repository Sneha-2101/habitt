import { requireStaff } from "@/lib/guards";
import { prisma } from "@/lib/prisma";
import CollectionManagerClient from "./CollectionManagerClient";

export const dynamic = "force-dynamic";

export default async function AdminCollectionsPage() {
  await requireStaff();

  const collections = await prisma.collection.findMany({
    select: {
      id: true,
      slug: true,
      name: true,
      position: true,
      active: true,
      _count: {
        select: { products: true, offerTargets: true },
      },
    },
    orderBy: { position: "asc" },
  });

  return (
    <main className="px-7 py-9 max-w-4xl mx-auto">
      <div className="flex justify-between items-center mb-7">
        <h1 className="font-display text-2xl font-medium">Collections</h1>
      </div>

      <CollectionManagerClient collections={collections} />
    </main>
  );
}
