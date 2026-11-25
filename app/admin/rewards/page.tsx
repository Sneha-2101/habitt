import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { ForbiddenError, requireRole, UnauthorizedError } from "@/lib/guards";
import { formatINR } from "@/lib/money";
import { getWalletSummary } from "@/lib/wallet/service";
import WalletAdjustForm from "./WalletAdjustForm";

export const dynamic = "force-dynamic";

export default async function AdminRewardsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; userId?: string }>;
}) {
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

  const sp = await searchParams;
  const q = sp.q?.trim() || "";
  const selectedUserId = sp.userId?.trim() || "";

  const settings = await prisma.siteSettings.findUnique({
    where: { id: "default" },
    select: {
      promoCreditExpiryDays: true,
      walletMaxPercentOfOrder: true,
      maxAdminAdjustPaise: true,
    },
  });

  const customers = await prisma.user.findMany({
    where: q
      ? {
          OR: [
            { email: { contains: q, mode: "insensitive" } },
            { phone: { contains: q, mode: "insensitive" } },
            { name: { contains: q, mode: "insensitive" } },
            { id: q },
          ],
        }
      : undefined,
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      storeCreditBalance: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: 25,
  });

  const activeCustomer = selectedUserId
    ? await prisma.user.findUnique({
        where: { id: selectedUserId },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          role: true,
          storeCreditBalance: true,
        },
      })
    : customers[0] || null;

  const summary = activeCustomer
    ? await getWalletSummary(activeCustomer.id)
    : null;

  return (
    <div className="max-w-6xl mx-auto px-7 py-8 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl text-ink">Rewards &amp; Wallet (Foundation)</h1>
          <p className="text-xs text-stone-dark mt-1">
            OWNER-only wallet ledger preview and manual adjustments.
          </p>
        </div>
        <div className="text-xs text-stone-dark">
          Promo expiry: <strong>{settings?.promoCreditExpiryDays ?? 90}d</strong> | Max order
          cap: <strong>{settings?.walletMaxPercentOfOrder ?? 100}%</strong> | Max adjust:{" "}
          <strong>{formatINR(settings?.maxAdminAdjustPaise ?? 500000)}</strong>
        </div>
      </div>

      <div className="border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
        <strong>Not Live Yet:</strong> Wallet is not live for customers yet. Balances here are not
        spendable at checkout until the cutover. Spendable store credit today is the legacy
        balance.
      </div>

      <form method="GET" className="flex gap-2">
        <input
          type="text"
          name="q"
          defaultValue={q}
          placeholder="Search customer by name, email, phone, or ID..."
          className="flex-1 border border-stone bg-white px-3 py-2 text-sm text-ink"
        />
        <button
          type="submit"
          className="bg-ink text-white px-4 py-2 text-xs uppercase tracking-wider"
        >
          Search
        </button>
      </form>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="border border-stone bg-white p-4 space-y-2">
          <h2 className="text-xs uppercase tracking-wider text-stone-dark font-semibold">
            Customers ({customers.length})
          </h2>
          <div className="divide-y divide-stone/50 max-h-[420px] overflow-y-auto">
            {customers.map((c) => {
              const isSelected = activeCustomer?.id === c.id;
              return (
                <Link
                  key={c.id}
                  href={`/admin/rewards?${new URLSearchParams({
                    ...(q ? { q } : {}),
                    userId: c.id,
                  }).toString()}`}
                  className={`block py-2 px-2 text-xs hover:bg-paper ${
                    isSelected ? "bg-paper font-semibold" : ""
                  }`}
                >
                  <div className="text-ink">{c.name || c.email || c.phone || c.id}</div>
                  <div className="text-stone-dark">
                    {c.email || c.phone || "No contact"} &middot; Legacy:{" "}
                    {formatINR(c.storeCreditBalance)}
                  </div>
                </Link>
              );
            })}
          </div>
        </div>

        <div className="lg:col-span-2 space-y-6">
          {activeCustomer && summary ? (
            <>
              <div className="border border-stone bg-white p-5 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-display text-ink">
                      {activeCustomer.name || activeCustomer.email || activeCustomer.id}
                    </h2>
                    <p className="text-xs text-stone-dark">
                      {activeCustomer.email || "—"} &middot; {activeCustomer.phone || "—"} &middot;{" "}
                      ID: {activeCustomer.id}
                    </p>
                  </div>
                  <div className="text-right space-y-1">
                    <div className="text-xs uppercase tracking-wider text-stone-dark">
                      Wallet Balance (Not Spendable Yet)
                    </div>
                    <div className="text-2xl font-display text-ink">
                      {formatINR(summary.balancePaise)}
                    </div>
                    <div className="text-xs text-stone-dark">
                      Legacy Store Credit (spendable today, read-only):{" "}
                      <strong className="text-ink">
                        {formatINR(activeCustomer.storeCreditBalance)}
                      </strong>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3 pt-2 border-t border-stone/50 text-xs">
                  <div>
                    <span className="text-stone-dark">Refund lots:</span>{" "}
                    <strong>{formatINR(summary.byKind.REFUND)}</strong>
                  </div>
                  <div>
                    <span className="text-stone-dark">Promo lots:</span>{" "}
                    <strong>{formatINR(summary.byKind.PROMO)}</strong>
                  </div>
                  <div>
                    <span className="text-stone-dark">Adjust lots:</span>{" "}
                    <strong>{formatINR(summary.byKind.ADJUST)}</strong>
                  </div>
                </div>
              </div>

              <WalletAdjustForm
                userId={activeCustomer.id}
                maxAdminAdjustPaise={settings?.maxAdminAdjustPaise ?? 500000}
              />

              <div className="border border-stone bg-white p-5 space-y-3">
                <h3 className="text-xs uppercase tracking-wider text-stone-dark font-semibold">
                  Active Wallet Lots ({summary.activeLots.length})
                </h3>
                {summary.activeLots.length === 0 ? (
                  <p className="text-xs text-stone-dark">No active wallet lots.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs text-left">
                      <thead>
                        <tr className="border-b border-stone text-stone-dark">
                          <th className="py-1.5 pr-3">Kind</th>
                          <th className="py-1.5 pr-3">Original</th>
                          <th className="py-1.5 pr-3">Remaining</th>
                          <th className="py-1.5 pr-3">Expires</th>
                          <th className="py-1.5">Source / Note</th>
                        </tr>
                      </thead>
                      <tbody>
                        {summary.activeLots.map((lot) => (
                          <tr key={lot.id} className="border-b border-stone/40">
                            <td className="py-1.5 pr-3 font-medium">{lot.kind}</td>
                            <td className="py-1.5 pr-3">{formatINR(lot.originalPaise)}</td>
                            <td className="py-1.5 pr-3">{formatINR(lot.remainingPaise)}</td>
                            <td className="py-1.5 pr-3">
                              {lot.expiresAt ? lot.expiresAt.toISOString().slice(0, 10) : "Never"}
                            </td>
                            <td className="py-1.5 text-stone-dark">
                              {lot.sourceType || "—"} {lot.note ? `(${lot.note})` : ""}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="border border-stone bg-white p-5 space-y-3">
                <h3 className="text-xs uppercase tracking-wider text-stone-dark font-semibold">
                  Recent Wallet Ledger ({summary.recentEntries.length})
                </h3>
                {summary.recentEntries.length === 0 ? (
                  <p className="text-xs text-stone-dark">No ledger entries yet.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs text-left">
                      <thead>
                        <tr className="border-b border-stone text-stone-dark">
                          <th className="py-1.5 pr-3">Date</th>
                          <th className="py-1.5 pr-3">Type</th>
                          <th className="py-1.5 pr-3">Amount</th>
                          <th className="py-1.5 pr-3">Balance After</th>
                          <th className="py-1.5">Reason</th>
                        </tr>
                      </thead>
                      <tbody>
                        {summary.recentEntries.map((entry) => (
                          <tr key={entry.id} className="border-b border-stone/40">
                            <td className="py-1.5 pr-3">
                              {entry.createdAt.toISOString().slice(0, 16).replace("T", " ")}
                            </td>
                            <td className="py-1.5 pr-3 font-medium">{entry.type}</td>
                            <td className="py-1.5 pr-3">
                              {entry.amountPaise > 0 ? "+" : ""}
                              {formatINR(entry.amountPaise)}
                            </td>
                            <td className="py-1.5 pr-3">{formatINR(entry.balanceAfterPaise)}</td>
                            <td className="py-1.5 text-stone-dark">{entry.reason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="border border-stone bg-white p-6 text-sm text-stone-dark">
              No matching customer found.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
