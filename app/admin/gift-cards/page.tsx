import { redirect } from "next/navigation";
import { ForbiddenError, requireRole, UnauthorizedError } from "@/lib/guards";
import { prisma } from "@/lib/prisma";
import { listGiftCards } from "@/lib/actions/gift-cards";
import GiftCardsClient from "./GiftCardsClient";

export const dynamic = "force-dynamic";

function getDefaultRedeemByIst(): string {
  const istMs = Date.now() + 5.5 * 60 * 60 * 1000;
  const d = new Date(istMs);
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

export default async function AdminGiftCardsPage() {
  try {
    await requireRole("OWNER");
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      redirect("/staff/login");
    }
    if (err instanceof ForbiddenError) {
      redirect("/admin");
    }
    throw err;
  }

  const [{ cards, outstandingLiabilityPaise }, settings] = await Promise.all([
    listGiftCards(),
    prisma.siteSettings.findUnique({
      where: { id: "default" },
      select: { maxAdminAdjustPaise: true },
    }),
  ]);

  return (
    <main className="px-7 py-9 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="font-display text-2xl font-medium text-ink">Gift cards</h1>
        <p className="text-xs text-stone-dark mt-1">
          Issue owner gift cards, monitor outstanding liability, and void unused cards.
        </p>
      </div>

      <GiftCardsClient
        initialCards={cards}
        outstandingLiabilityPaise={outstandingLiabilityPaise}
        maxAdminAdjustPaise={settings?.maxAdminAdjustPaise ?? 500000}
        defaultRedeemByIst={getDefaultRedeemByIst()}
      />
    </main>
  );
}
