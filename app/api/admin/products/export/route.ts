import { NextResponse } from "next/server";
import { requireStaff, UnauthorizedError, ForbiddenError } from "@/lib/guards";
import { exportProductsCsv } from "@/lib/admin/csv-products";
import { writeAudit } from "@/lib/audit";

export async function GET() {
  try {
    const staff = await requireStaff();
    const csvContent = await exportProductsCsv(staff.role);

    await writeAudit({
      actorId: staff.id,
      action: "export.products",
      entity: "Product",
      entityId: "bulk",
      meta: { role: staff.role },
    });

    return new NextResponse(csvContent, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="habitt_products_export_${Date.now()}.csv"`,
      },
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return new NextResponse("Unauthorized", { status: 401 });
    }
    if (err instanceof ForbiddenError) {
      return new NextResponse("Forbidden: Staff or Owner access required", { status: 403 });
    }
    throw err;
  }
}
