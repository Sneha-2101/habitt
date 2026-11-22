import { redirect } from "next/navigation";
import { signOut } from "@/lib/auth";
import { getSessionUser } from "@/lib/sessions";
import { prisma } from "@/lib/prisma";
import AccountClient from "@/components/AccountClient";
import AccountSignOutButton from "@/components/AccountSignOutButton";
import { legacyStage, getOrderStatusLabel } from "@/lib/orders/status-label";

export default async function AccountPage() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect("/login?redirect=/account");

  const userId = sessionUser.id;

  const [user, addresses, orders] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        dateOfBirth: true,
        storeCreditBalance: true,
        storeCreditTransactions: {
          orderBy: { createdAt: "desc" },
          take: 20,
        },
      },
    }),
    prisma.address.findMany({
      where: { userId },
      orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
    }),
    prisma.order.findMany({
      where: { userId },
      include: {
        items: true,
        statusEvents: { orderBy: { createdAt: "asc" } },
        returnRequests: { orderBy: { createdAt: "desc" } },
        invoice: { select: { id: true } },
        creditNotes: { select: { id: true }, take: 1 },
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  if (!user) redirect("/login?redirect=/account");

  const allVariantIds = Array.from(
    new Set(orders.flatMap((o) => o.items.map((i) => i.variantId)).filter(Boolean))
  );
  const variants = await prisma.productVariant.findMany({
    where: { id: { in: allVariantIds } },
    select: { id: true, stock: true },
  });
  const variantStockMap = new Map(variants.map((v) => [v.id, v.stock]));

  const ordersWithStock = orders.map((o) => {
    const { invoice, creditNotes, ...orderRest } = o;
    return {
      ...orderRest,
      hasInvoice: Boolean(invoice),
      hasCreditNote: Boolean(creditNotes && creditNotes.length > 0),
      status: legacyStage(o),
      statusLabel: getOrderStatusLabel(o).label,
      items: o.items.map((item) => ({
        ...item,
        color: item.color,
        currentStock: variantStockMap.get(item.variantId) ?? 0,
      })),
    };
  });

  return (
    <main className="max-w-xl mx-auto px-4 sm:px-7 py-12">
      <div className="flex items-center justify-between mb-8 pb-4 border-b border-stone">
        <div>
          <h1 className="font-display text-2xl mb-0.5 text-ink">Account Overview</h1>
          <p className="text-[13px] text-stone-dark">{user.email || user.phone || "Welcome back"}</p>
        </div>
        <AccountSignOutButton
          signOutAction={async () => {
            "use server";
            await signOut({ redirectTo: "/" });
          }}
        />
      </div>

      <AccountClient user={user} addresses={addresses} orders={ordersWithStock} />
    </main>
  );
}
