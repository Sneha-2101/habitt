import { requireStaff } from "@/lib/guards";
import { prisma } from "@/lib/prisma";
import AdminGstForm from "./AdminGstForm";

export const metadata = {
  title: "GST & Invoicing — Admin | Habitt",
};

export default async function AdminGstPage() {
  await requireStaff();

  let settings = await prisma.siteSettings.findUnique({
    where: { id: "default" },
  });

  if (!settings) {
    settings = await prisma.siteSettings.create({
      data: {
        id: "default",
        gstEnabled: false,
        gstRate: 0.0,
        invoicePrefix: "HB",
        businessState: null,
      },
    });
  }

  const [rules, categories] = await Promise.all([
    prisma.gstRule.findMany({
      orderBy: [{ active: "desc" }, { createdAt: "desc" }],
    }),
    prisma.category.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <div className="max-w-6xl mx-auto px-7 py-8 space-y-6">
      <div className="border-b border-stone pb-4">
        <h1 className="font-display text-2xl font-semibold text-ink">
          GST & Tax Invoicing
        </h1>
        <p className="text-xs text-stone-dark mt-1">
          Configure Indian GST tax extraction, rate slabs by HSN/Category, and automated invoice sequencing.
        </p>
      </div>

      <AdminGstForm
        settings={{
          gstEnabled: settings.gstEnabled,
          gstRate: settings.gstRate,
          gstin: settings.gstin,
          gstFeeMode: settings.gstFeeMode,
          gstFeeRate: settings.gstFeeRate,
          invoicePrefix: settings.invoicePrefix,
          businessState: settings.businessState,
        }}
        rules={rules.map((r) => ({
          id: r.id,
          name: r.name,
          hsn: r.hsn,
          categoryId: r.categoryId,
          minUnitPaise: r.minUnitPaise,
          maxUnitPaise: r.maxUnitPaise,
          ratePercent: Number(r.ratePercent),
          active: r.active,
        }))}
        categories={categories}
      />
    </div>
  );
}
