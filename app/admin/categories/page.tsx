import { requireStaff } from "@/lib/guards";
import { prisma } from "@/lib/prisma";
import CategoryManagerClient from "./CategoryManagerClient";

export const dynamic = "force-dynamic";

export default async function AdminCategoriesPage() {
  await requireStaff();

  const categories = await prisma.category.findMany({
    include: {
      _count: {
        select: { products: true },
      },
    },
    orderBy: { position: "asc" },
  });

  return (
    <main className="px-7 py-9 max-w-4xl mx-auto">
      <div className="flex justify-between items-center mb-7">
        <h1 className="font-display text-2xl font-medium">Categories</h1>
      </div>

      <CategoryManagerClient categories={categories} />
    </main>
  );
}
