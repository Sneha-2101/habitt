import Link from "next/link";
import { requireStaff } from "@/lib/guards";
import { prisma } from "@/lib/prisma";
import OffersListClient from "./OffersListClient";

export const dynamic = "force-dynamic";

export default async function AdminOffersPage() {
  await requireStaff();

  const offers = await prisma.offer.findMany({
    select: {
      id: true,
      name: true,
      kind: true,
      code: true,
      active: true,
      startsAt: true,
      endsAt: true,
      minCartPaise: true,
      timesUsed: true,
      priority: true,
      audience: true,
      config: true,
      legacyCouponId: true,
      createdAt: true,
      _count: {
        select: { redemptions: true },
      },
    },
    orderBy: [{ priority: "asc" }, { createdAt: "desc" }],
  });

  return (
    <main className="px-7 py-9 max-w-5xl mx-auto">
      <div className="flex justify-between items-center mb-7">
        <div>
          <h1 className="font-display text-2xl font-medium">Offers &amp; Promotions</h1>
          <p className="text-xs text-stone-dark mt-1">
            Manage discounts, automatic promotions, tiered sales, combos, and coupon codes.
          </p>
        </div>
        <Link
          href="/admin/offers/new"
          className="h-[40px] px-5 bg-ink text-white text-xs uppercase tracking-wider font-medium flex items-center hover:bg-ink/80 transition-colors"
        >
          Create Offer
        </Link>
      </div>

      <OffersListClient offers={offers} />
    </main>
  );
}
