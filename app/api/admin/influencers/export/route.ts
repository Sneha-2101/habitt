import { NextResponse } from "next/server";
import { ForbiddenError, requireRole, UnauthorizedError } from "@/lib/guards";
import { sanitizeCsvCell } from "@/lib/csv";
import { formatIstDate, parseIstDateRange } from "@/lib/admin/reports";
import { getInfluencerStats } from "@/lib/influencers/stats";
import { writeAudit } from "@/lib/audit";

export async function GET(req: Request) {
  let owner;
  try {
    owner = await requireRole("OWNER");
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return new NextResponse("Unauthorized", { status: 401 });
    }
    if (err instanceof ForbiddenError) {
      return new NextResponse("Forbidden: Owner access required", { status: 403 });
    }
    throw err;
  }

  const { searchParams } = new URL(req.url);
  const influencerId = searchParams.get("id")?.trim() || undefined;
  const { fromUtc, toUtc, fromIst, toIst } = parseIstDateRange(
    searchParams.get("from"),
    searchParams.get("to")
  );

  const { influencers, orders } = await getInfluencerStats({
    influencerId,
    from: fromUtc,
    to: toUtc,
  });

  let csvContent = "";

  if (influencerId) {
    const headers = [
      "Order Number",
      "Date (IST)",
      "Payment Status",
      "Fulfilment Status",
      "Goods Net (INR)",
      "Refunded Goods (INR)",
      "Source",
      "Self Order",
    ];
    const rows = orders.map((o) => [
      sanitizeCsvCell(o.orderNumber),
      sanitizeCsvCell(formatIstDate(o.createdAt)),
      sanitizeCsvCell(o.paymentStatus),
      sanitizeCsvCell(o.fulfilmentStatus),
      sanitizeCsvCell((o.goodsNetPaise / 100).toFixed(2)),
      sanitizeCsvCell((o.refundedGoodsPaise / 100).toFixed(2)),
      sanitizeCsvCell(o.source || ""),
      sanitizeCsvCell(o.isSelfOrder ? "Yes" : "No"),
    ]);
    csvContent = [
      headers.map(sanitizeCsvCell).join(","),
      ...rows.map((r) => r.join(",")),
    ].join("\n");
  } else {
    const headers = [
      "Influencer Name",
      "Code",
      "Orders Placed",
      "Orders Delivered",
      "Goods Sales (INR)",
      "Refunded Goods (INR)",
      "Net Goods (INR)",
    ];
    const rows = influencers.map((inf) => [
      sanitizeCsvCell(inf.name),
      sanitizeCsvCell(inf.code),
      sanitizeCsvCell(inf.summary.ordersPlaced),
      sanitizeCsvCell(inf.summary.ordersDelivered),
      sanitizeCsvCell((inf.summary.goodsSalesPaise / 100).toFixed(2)),
      sanitizeCsvCell((inf.summary.refundedGoodsPaise / 100).toFixed(2)),
      sanitizeCsvCell((inf.summary.netGoodsPaise / 100).toFixed(2)),
    ]);
    csvContent = [
      headers.map(sanitizeCsvCell).join(","),
      ...rows.map((r) => r.join(",")),
    ].join("\n");
  }

  await writeAudit({
    actorId: owner.id,
    action: "export.influencers",
    entity: "Influencer",
    entityId: influencerId || "bulk",
    meta: {
      count: influencerId ? orders.length : influencers.length,
      fromIst,
      toIst,
    },
  });

  return new NextResponse(csvContent, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="habitt_influencers_${fromIst}_to_${toIst}.csv"`,
    },
  });
}
