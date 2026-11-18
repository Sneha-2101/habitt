import { NextResponse } from "next/server";
import { requireStaff, UnauthorizedError, ForbiddenError } from "@/lib/guards";
import { prisma } from "@/lib/prisma";
import { sanitizeCsvCell } from "@/lib/csv";
import { buildOrderWhere } from "@/lib/orders/status-filter";

export async function GET(req: Request) {
  try {
    await requireStaff();
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
    include: { items: true },
    orderBy: { createdAt: "desc" },
  });

  const headers = [
    "Order ID",
    "Customer Name",
    "Email",
    "Phone",
    "Payment Status",
    "Fulfilment Status",
    "Items Count",
    "Subtotal (INR)",
    "Shipping Fee (INR)",
    "Total (INR)",
    "Courier",
    "AWB Number",
    "Created Date",
  ];

  const rows = orders.map((o) => {
    const itemCount = o.items.reduce((sum, item) => sum + item.qty, 0);
    return [
      sanitizeCsvCell(o.displayId),
      sanitizeCsvCell(o.customerName || ""),
      sanitizeCsvCell(o.customerEmail || ""),
      sanitizeCsvCell(o.customerPhone || ""),
      sanitizeCsvCell(o.paymentStatus),
      sanitizeCsvCell(o.fulfilmentStatus),
      sanitizeCsvCell(itemCount),
      sanitizeCsvCell((o.subtotal / 100).toFixed(2)),
      sanitizeCsvCell((o.shippingFee / 100).toFixed(2)),
      sanitizeCsvCell((o.total / 100).toFixed(2)),
      sanitizeCsvCell(o.courierName || ""),
      sanitizeCsvCell(o.awbNumber || ""),
      sanitizeCsvCell(new Date(o.createdAt).toISOString().split("T")[0]),
    ];
  });

  const csvContent = [headers.map(sanitizeCsvCell).join(","), ...rows.map((row) => row.join(","))].join("\n");

  return new NextResponse(csvContent, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="habitt_orders_export_${Date.now()}.csv"`,
    },
  });
}
