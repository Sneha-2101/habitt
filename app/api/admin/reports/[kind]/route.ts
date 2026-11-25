import { NextResponse } from "next/server";
import { requireStaff, UnauthorizedError, ForbiddenError } from "@/lib/guards";
import { prisma } from "@/lib/prisma";
import { sanitizeCsvCell } from "@/lib/csv";
import {
  salesReport,
  gstSummary,
  returnsReport,
  stockReport,
  offersUsageReport,
  marginReport,
} from "@/lib/admin/reports";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ kind: string }> }
) {
  let user;
  try {
    user = await requireStaff();
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return new NextResponse("Unauthorized", { status: 401 });
    }
    if (err instanceof ForbiddenError) {
      return new NextResponse("Forbidden: Staff access required", { status: 403 });
    }
    throw err;
  }

  const { kind } = await params;
  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  let csvContent = "";
  const filename = `habitt_report_${kind}_${Date.now()}.csv`;

  switch (kind) {
    case "sales": {
      const report = await salesReport(from, to);
      const headers = [
        "Date (IST)",
        "Orders Count",
        "Gross (INR)",
        "Discounts (INR)",
        "Shipping & COD Fees (INR)",
        "Refunds (INR)",
        "Net Sales (INR)",
      ];
      const rows = report.daily.map((d) => [
        sanitizeCsvCell(d.date),
        sanitizeCsvCell(d.orders),
        sanitizeCsvCell((d.grossPaise / 100).toFixed(2)),
        sanitizeCsvCell((d.discountPaise / 100).toFixed(2)),
        sanitizeCsvCell((d.shippingCodFeesPaise / 100).toFixed(2)),
        sanitizeCsvCell((d.refundsPaise / 100).toFixed(2)),
        sanitizeCsvCell((d.netPaise / 100).toFixed(2)),
      ]);
      rows.push([
        sanitizeCsvCell("TOTAL"),
        sanitizeCsvCell(report.total.orders),
        sanitizeCsvCell((report.total.grossPaise / 100).toFixed(2)),
        sanitizeCsvCell((report.total.discountPaise / 100).toFixed(2)),
        sanitizeCsvCell((report.total.shippingCodFeesPaise / 100).toFixed(2)),
        sanitizeCsvCell((report.total.refundsPaise / 100).toFixed(2)),
        sanitizeCsvCell((report.total.netPaise / 100).toFixed(2)),
      ]);
      csvContent = [headers.map(sanitizeCsvCell).join(","), ...rows.map((r) => r.join(","))].join("\n");
      break;
    }

    case "gst": {
      const report = await gstSummary(from, to);
      const headers = [
        "GST Rate (%)",
        "Taxable Turnover (INR)",
        "CGST (INR)",
        "SGST (INR)",
        "IGST (INR)",
        "Total Tax (INR)",
        "Net Total (INR)",
      ];
      const rows = report.rates.map((r) => [
        sanitizeCsvCell(`${r.ratePercent}%`),
        sanitizeCsvCell((r.taxablePaise / 100).toFixed(2)),
        sanitizeCsvCell((r.cgstPaise / 100).toFixed(2)),
        sanitizeCsvCell((r.sgstPaise / 100).toFixed(2)),
        sanitizeCsvCell((r.igstPaise / 100).toFixed(2)),
        sanitizeCsvCell((r.totalTaxPaise / 100).toFixed(2)),
        sanitizeCsvCell((r.netPaise / 100).toFixed(2)),
      ]);
      rows.push([
        sanitizeCsvCell("TOTAL"),
        sanitizeCsvCell((report.total.taxablePaise / 100).toFixed(2)),
        sanitizeCsvCell((report.total.cgstPaise / 100).toFixed(2)),
        sanitizeCsvCell((report.total.sgstPaise / 100).toFixed(2)),
        sanitizeCsvCell((report.total.igstPaise / 100).toFixed(2)),
        sanitizeCsvCell((report.total.totalTaxPaise / 100).toFixed(2)),
        sanitizeCsvCell((report.total.netPaise / 100).toFixed(2)),
      ]);
      csvContent = [headers.map(sanitizeCsvCell).join(","), ...rows.map((r) => r.join(","))].join("\n");
      break;
    }

    case "returns": {
      const report = await returnsReport(from, to);
      const headers = ["Metric", "Value"];
      const rows = [
        [sanitizeCsvCell("Total Return Requests"), sanitizeCsvCell(report.requests)],
        [sanitizeCsvCell("Approved Returns"), sanitizeCsvCell(report.approved)],
        [sanitizeCsvCell("Received Returns"), sanitizeCsvCell(report.received)],
        [sanitizeCsvCell("Refunded Returns"), sanitizeCsvCell(report.refunded)],
        [sanitizeCsvCell("Total Refund Amount (INR)"), sanitizeCsvCell((report.refundTotalPaise / 100).toFixed(2))],
        [sanitizeCsvCell("Avg Approval to Refund (Hours)"), sanitizeCsvCell(report.avgApprovalToRefundHours)],
        [sanitizeCsvCell("SLA Breaches (>48h)"), sanitizeCsvCell(report.slaBreaches)],
      ];
      for (const rc of report.topReasonCodes) {
        rows.push([sanitizeCsvCell(`Reason: ${rc.code}`), sanitizeCsvCell(rc.count)]);
      }
      csvContent = [headers.map(sanitizeCsvCell).join(","), ...rows.map((r) => r.join(","))].join("\n");
      break;
    }

    case "stock": {
      const report = await stockReport(user.role);
      const isOwner = user.role === "OWNER";
      const headers = [
        "Product Name",
        "Product Slug",
        "Color",
        "Size",
        "SKU",
        "Stock",
        "Status",
        "List Price (INR)",
        ...(isOwner ? ["Cost Price (INR)"] : []),
      ];
      const rows = report.variants.map((v) => {
        const status = v.isOutOfStock ? "OUT_OF_STOCK" : v.isLowStock ? "LOW_STOCK" : "IN_STOCK";
        return [
          sanitizeCsvCell(v.productName),
          sanitizeCsvCell(v.productSlug),
          sanitizeCsvCell(v.color),
          sanitizeCsvCell(v.size),
          sanitizeCsvCell(v.sku || ""),
          sanitizeCsvCell(v.stock),
          sanitizeCsvCell(status),
          sanitizeCsvCell((v.pricePaise / 100).toFixed(2)),
          ...(isOwner ? [sanitizeCsvCell(v.costPricePaise !== null ? (v.costPricePaise / 100).toFixed(2) : "")] : []),
        ];
      });
      csvContent = [headers.map(sanitizeCsvCell).join(","), ...rows.map((r) => r.join(","))].join("\n");
      break;
    }

    case "offers": {
      const report = await offersUsageReport(from, to);
      const headers = [
        "Offer Name",
        "Coupon Code",
        "Type",
        "Redemptions",
        "Discount Given (INR)",
      ];
      const rows = report.offers.map((o) => [
        sanitizeCsvCell(o.name),
        sanitizeCsvCell(o.code || ""),
        sanitizeCsvCell(o.kind),
        sanitizeCsvCell(o.redemptions),
        sanitizeCsvCell((o.totalDiscountPaise / 100).toFixed(2)),
      ]);
      csvContent = [headers.map(sanitizeCsvCell).join(","), ...rows.map((r) => r.join(","))].join("\n");
      break;
    }

    case "margin": {
      if (user.role !== "OWNER") {
        return new NextResponse("Forbidden: Owner access required for Margin report", { status: 403 });
      }
      const report = await marginReport(from, to, user.role);
      const headers = [
        "Product Name",
        "Product Slug",
        "Units Sold",
        "Revenue (INR)",
        "Cost (INR)",
        "Gross Margin (INR)",
        "Margin (%)",
      ];
      const rows = report.items.map((it) => [
        sanitizeCsvCell(it.productName),
        sanitizeCsvCell(it.productSlug),
        sanitizeCsvCell(it.unitsSold),
        sanitizeCsvCell((it.revenuePaise / 100).toFixed(2)),
        sanitizeCsvCell((it.costPaise / 100).toFixed(2)),
        sanitizeCsvCell((it.marginPaise / 100).toFixed(2)),
        sanitizeCsvCell(`${it.marginPercent}%`),
      ]);
      rows.push([
        sanitizeCsvCell("TOTAL"),
        sanitizeCsvCell(""),
        sanitizeCsvCell(""),
        sanitizeCsvCell((report.totalRevenuePaise / 100).toFixed(2)),
        sanitizeCsvCell((report.totalCostPaise / 100).toFixed(2)),
        sanitizeCsvCell((report.grossMarginPaise / 100).toFixed(2)),
        sanitizeCsvCell(`${report.marginPercent}%`),
      ]);
      csvContent = [headers.map(sanitizeCsvCell).join(","), ...rows.map((r) => r.join(","))].join("\n");
      break;
    }

    default:
      return new NextResponse("Invalid report kind", { status: 400 });
  }

  // Record AuditLog
  await prisma.auditLog.create({
    data: {
      actorId: user.id,
      action: `REPORT_EXPORT_${kind.toUpperCase()}`,
      entity: "Report",
      meta: { kind, from: from || null, to: to || null },
    },
  });

  return new NextResponse(csvContent, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
