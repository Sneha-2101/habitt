import { redirect } from "next/navigation";
import { signOut } from "@/lib/auth";
import { getSessionUser } from "@/lib/sessions";
import { prisma } from "@/lib/prisma";
import AccountClient from "@/components/AccountClient";
import AccountSignOutButton from "@/components/AccountSignOutButton";
import { legacyStage, getOrderStatusLabel } from "@/lib/orders/status-label";
import { getSettings } from "@/lib/settings";
import { isReturnWindowOpen, remainingReturnableQty } from "@/lib/returns/rules";

export default async function AccountPage() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect("/login?redirect=/account");

  const userId = sessionUser.id;

  const [user, addresses, orders, settings, rawTickets] = await Promise.all([
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
        returnRequests: {
          orderBy: { createdAt: "desc" },
          include: { items: true },
        },
        invoice: { select: { id: true } },
        creditNotes: { select: { id: true }, take: 1 },
        shipments: {
          include: {
            events: { orderBy: { occurredAt: "asc" } },
          },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    getSettings(),
    prisma.ticket.findMany({
      where: { userId },
      select: {
        id: true,
        number: true,
        subject: true,
        category: true,
        status: true,
        orderRef: true,
        ackDueAt: true,
        resolveDueAt: true,
        acknowledgedAt: true,
        resolvedAt: true,
        closedAt: true,
        createdAt: true,
        messages: {
          where: { internal: false },
          select: {
            id: true,
            authorType: true,
            body: true,
            createdAt: true,
          },
          orderBy: { createdAt: "asc" },
        },
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
    const windowOpen = isReturnWindowOpen(
      o.deliveredAt,
      new Date(),
      settings.returnWindowDays || 7
    );

    const activeReturns = o.returnRequests.filter(
      (r) => r.status !== "CANCELLED" && r.status !== "REJECTED"
    );

    const existingReturnedByItem = new Map<string, number>();
    for (const req of activeReturns) {
      for (const it of req.items) {
        existingReturnedByItem.set(
          it.orderItemId,
          (existingReturnedByItem.get(it.orderItemId) || 0) + it.qty
        );
      }
    }

    const latestShipment = o.shipments?.[0];
    const friendlyShipment = latestShipment
      ? {
          status: latestShipment.status,
          courierName: latestShipment.courierName,
          awb: latestShipment.awb,
          trackingUrl: latestShipment.trackingUrl,
          events: latestShipment.events.map((ev) => ({
            id: ev.id,
            status: ev.status,
            rawStatus: ev.rawStatus,
            location: ev.location,
            occurredAt: ev.occurredAt,
          })),
        }
      : null;

    return {
      ...orderRest,
      shipment: friendlyShipment,
      isReturnWindowOpen: windowOpen,
      hasInvoice: Boolean(invoice),
      hasCreditNote: Boolean(creditNotes && creditNotes.length > 0),
      status: legacyStage(o),
      statusLabel: getOrderStatusLabel(o).label,
      items: o.items.map((item) => ({
        id: item.id,
        productId: item.productId,
        variantId: item.variantId,
        name: item.name,
        size: item.size,
        color: item.color || undefined,
        unitPrice: item.unitPrice,
        qty: item.qty,
        isGift: item.isGift,
        currentStock: variantStockMap.get(item.variantId) ?? 0,
        remainingReturnable: remainingReturnableQty(
          item,
          existingReturnedByItem.get(item.id) || 0
        ),
      })),
    };
  });

  const formattedTickets = rawTickets.map((t) => ({
    ...t,
    messages: t.messages.map((m) => ({
      id: m.id,
      author: m.authorType === "CUSTOMER" ? "You" : "Support team",
      body: m.body,
      createdAt: m.createdAt,
    })),
  }));

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

      <AccountClient
        user={user}
        addresses={addresses}
        orders={ordersWithStock}
        tickets={formattedTickets}
      />
    </main>
  );
}
