import { NextResponse } from "next/server";
import { requireStaff, UnauthorizedError, ForbiddenError } from "@/lib/guards";
import { prisma } from "@/lib/prisma";
import { sanitizeCsvCell } from "@/lib/csv";
import { buildOrderWhere } from "@/lib/orders/status-filter";
import { formatIstDate } from "@/lib/admin/reports";
import { writeAudit } from "@/lib/audit";

export async function GET(req: Request) {
  let staff;
  try {
    staff = await requireStaff();
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return new NextResponse("Unauthorized", { status: 401 });
    }
    if (err instanceof ForbiddenError) {
      return new NextResponse("Forbidden: Staff or Owner access required", { status: 403 });
    }
    throw err;
  }

  const { searchParams } = new URL(req.url);
  const statusParam = searchParams.get("status");
  const paymentMethodParam = searchParams.get("paymentMethod");
  const queryParam = searchParams.get("q")?.trim() || "";

  const whereClause = buildOrderWhere({
    status: statusParam,
    paymentMethod: paymentMethodParam,
    q: queryParam,
  });

  const orders = await prisma.order.findMany({
    where: whereClause,
    include: {
      items: true,
      invoice: true,
      discounts: true,
    },
    orderBy: { createdAt: "desc" },
  });

  const headers = [
    "Order ID",
    "Date (IST)",
    "Customer Name",
    "Email",
    "Phone",
    "Payment Status",
    "Fulfilment Status",
    "Items Count",
    "Subtotal (INR)",
    "Shipping Fee (INR)",
    "COD Fee (INR)",
    "Discount (INR)",
    "Total (INR)",
    "GST Invoice Number",
    "Courier",
    "AWB Number",
  ];

  const rows = orders.map((o) => {
    const itemCount = o.items.reduce((sum, item) => sum + item.qty, 0);
    const discountPaise = (o.discounts || []).reduce((sum, d) => sum + d.amountPaise, 0);
    return [
      sanitizeCsvCell(o.displayId),
      sanitizeCsvCell(formatIstDate(o.createdAt)),
      sanitizeCsvCell(o.customerName || ""),
      sanitizeCsvCell(o.customerEmail || ""),
      sanitizeCsvCell(o.customerPhone || ""),
      sanitizeCsvCell(o.paymentStatus),
      sanitizeCsvCell(o.fulfilmentStatus),
      sanitizeCsvCell(itemCount),
      sanitizeCsvCell((o.subtotal / 100).toFixed(2)),
      sanitizeCsvCell((o.shippingFee / 100).toFixed(2)),
      sanitizeCsvCell(((o.codFee || 0) / 100).toFixed(2)),
      sanitizeCsvCell((discountPaise / 100).toFixed(2)),
      sanitizeCsvCell((o.total / 100).toFixed(2)),
      sanitizeCsvCell(o.invoice?.number || ""),
      sanitizeCsvCell(o.courierName || ""),
      sanitizeCsvCell(o.awbNumber || ""),
    ];
  });

  const csvContent = [headers.map(sanitizeCsvCell).join(","), ...rows.map((row) => row.join(","))].join("\n");

  await writeAudit({
    actorId: staff.id,
    action: "export.orders",
    entity: "Order",
    entityId: "bulk",
    meta: {
      count: orders.length,
      filters: { status: statusParam, paymentMethod: paymentMethodParam, q: queryParam },
    },
  });

  return new NextResponse(csvContent, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="habitt_orders_export_${Date.now()}.csv"`,
    },
  });
}
