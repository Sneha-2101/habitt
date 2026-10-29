import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sanitizeCsvCell } from "@/lib/csv";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const role = (session.user as { role?: string }).role;
  if (role !== "STAFF" && role !== "OWNER") {
    return new NextResponse("Forbidden: Staff or Owner access required", { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const statusParam = searchParams.get("status");
  const queryParam = searchParams.get("q")?.trim() || "";

  const whereClause: Prisma.OrderWhereInput = {
    ...(statusParam ? { status: statusParam as never } : {}),
    ...(queryParam
      ? {
          OR: [
            { displayId: { contains: queryParam, mode: "insensitive" } },
            { customerName: { contains: queryParam, mode: "insensitive" } },
            { customerEmail: { contains: queryParam, mode: "insensitive" } },
          ],
        }
      : {}),
  };

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
    "Status",
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
      sanitizeCsvCell(o.status),
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
