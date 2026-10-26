import { redirect } from "next/navigation";
import { auth, signOut } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import AccountClient from "@/components/AccountClient";

export default async function AccountPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login?redirect=/account");

  const userId = session.user.id;

  const [user, defaultAddress, orders] = await Promise.all([
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
    prisma.address.findFirst({
      where: { userId, isDefault: true },
      select: { id: true, street: true, city: true, state: true, pincode: true },
    }),
    prisma.order.findMany({
      where: { userId },
      include: {
        items: true,
        statusEvents: { orderBy: { createdAt: "asc" } },
        returnRequests: { orderBy: { createdAt: "desc" } },
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

  const ordersWithStock = orders.map((o) => ({
    ...o,
    items: o.items.map((item) => ({
      ...item,
      currentStock: variantStockMap.get(item.variantId) ?? 0,
    })),
  }));

  return (
    <main className="max-w-xl mx-auto px-4 sm:px-7 py-12">
      <div className="flex items-center justify-between mb-8 pb-4 border-b border-stone">
        <div>
          <h1 className="font-display text-2xl mb-0.5 text-ink">Account Overview</h1>
          <p className="text-[13px] text-stone-dark">{user.email || user.phone || "Welcome back"}</p>
        </div>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/" });
          }}
        >
          <button type="submit" className="text-[12.5px] font-medium text-clay hover:underline">
            Sign out
          </button>
        </form>
      </div>

      <AccountClient user={user} address={defaultAddress} orders={ordersWithStock} />
    </main>
  );
}
