import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/sessions";
import { prisma } from "@/lib/prisma";
import { formatINR } from "@/lib/money";
import { escapeHtml } from "@/lib/escape-html";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const resolvedParams = await params;
  const sessionUser = await getSessionUser();

  if (!sessionUser?.id) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const userId = sessionUser.id;
  const role = sessionUser.role;
  const isStaff = role === "STAFF" || role === "OWNER";

  const order = await prisma.order.findUnique({
    where: { id: resolvedParams.id },
    include: {
      user: true,
      creditNotes: {
        include: { lines: true, invoice: true },
        orderBy: { issuedAt: "desc" },
      },
    },
  });

  if (!order) {
    return new NextResponse("Order not found", { status: 404 });
  }

  // Guard: requires order owner or staff/owner
  if (order.userId !== userId && !isStaff) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  if (!order.creditNotes || order.creditNotes.length === 0) {
    return new NextResponse("No credit notes found for this order", {
      status: 404,
    });
  }

  const creditNotesHtml = order.creditNotes
    .map((cn) => {
      const isInterState = cn.igstPaise > 0;
      const cnDateStr = new Date(cn.issuedAt).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });

      const linesHtml = cn.lines
        .map(
          (line, idx) => `
        <tr>
          <td style="padding: 8px; border-bottom: 1px solid #e5e5e5; font-size: 12px; text-align: center;">${idx + 1}</td>
          <td style="padding: 8px; border-bottom: 1px solid #e5e5e5; font-size: 12px;">${escapeHtml(line.description)}</td>
          <td style="padding: 8px; border-bottom: 1px solid #e5e5e5; font-size: 12px; text-align: center;">${line.qty}</td>
          <td style="padding: 8px; border-bottom: 1px solid #e5e5e5; font-size: 12px; text-align: center;">${Number(line.ratePercent)}%</td>
          <td style="padding: 8px; border-bottom: 1px solid #e5e5e5; font-size: 12px; text-align: right;">${formatINR(line.taxablePaise)}</td>
          ${
            isInterState
              ? `<td style="padding: 8px; border-bottom: 1px solid #e5e5e5; font-size: 12px; text-align: right;">${formatINR(line.igstPaise)}</td>`
              : `
            <td style="padding: 8px; border-bottom: 1px solid #e5e5e5; font-size: 12px; text-align: right;">${formatINR(line.cgstPaise)}</td>
            <td style="padding: 8px; border-bottom: 1px solid #e5e5e5; font-size: 12px; text-align: right;">${formatINR(line.sgstPaise)}</td>
          `
          }
          <td style="padding: 8px; border-bottom: 1px solid #e5e5e5; font-size: 12px; text-align: right; font-weight: 500;">${formatINR(line.totalPaise)}</td>
        </tr>
      `
        )
        .join("");

      return `
      <div class="cn-block" style="border: 1px solid #ddd; padding: 25px; border-radius: 4px; margin-bottom: 30px;">
        <div style="display: flex; justify-content: space-between; border-bottom: 2px solid #111; padding-bottom: 15px; margin-bottom: 20px;">
          <div>
            <h2 style="margin: 0; font-size: 20px; font-weight: 700;">CREDIT NOTE</h2>
            <p style="margin: 4px 0 0; font-family: monospace; font-size: 14px; font-weight: 600;">${escapeHtml(cn.number)}</p>
            <p style="margin: 4px 0 0; font-size: 12px; color: #555;">Date: ${cnDateStr}</p>
          </div>
          <div style="text-align: right; font-size: 12px;">
            <p style="margin: 0;">Against Invoice: <strong>${escapeHtml(cn.invoice?.number || `#${order.displayId}`)}</strong></p>
            <p style="margin: 4px 0 0;">Order Ref: <strong>#${escapeHtml(order.displayId)}</strong></p>
            <p style="margin: 4px 0 0; color: #555;">Reason: ${escapeHtml(cn.reason)}</p>
          </div>
        </div>

        <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
          <thead>
            <tr>
              <th style="width: 30px; text-align: center; background: #f0ede6; padding: 8px; font-size: 11px;">#</th>
              <th style="text-align: left; background: #f0ede6; padding: 8px; font-size: 11px;">Description</th>
              <th style="width: 40px; text-align: center; background: #f0ede6; padding: 8px; font-size: 11px;">Qty</th>
              <th style="width: 50px; text-align: center; background: #f0ede6; padding: 8px; font-size: 11px;">Rate</th>
              <th style="width: 85px; text-align: right; background: #f0ede6; padding: 8px; font-size: 11px;">Taxable</th>
              ${
                isInterState
                  ? `<th style="width: 80px; text-align: right; background: #f0ede6; padding: 8px; font-size: 11px;">IGST</th>`
                  : `
                <th style="width: 75px; text-align: right; background: #f0ede6; padding: 8px; font-size: 11px;">CGST</th>
                <th style="width: 75px; text-align: right; background: #f0ede6; padding: 8px; font-size: 11px;">SGST</th>
              `
              }
              <th style="width: 90px; text-align: right; background: #f0ede6; padding: 8px; font-size: 11px;">Total Credit</th>
            </tr>
          </thead>
          <tbody>
            ${linesHtml}
          </tbody>
        </table>

        <div style="margin-left: auto; width: 280px; font-size: 13px;">
          <div style="display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px solid #eee;">
            <span>Credited Taxable</span>
            <span>${formatINR(cn.taxablePaise)}</span>
          </div>
          ${
            isInterState
              ? `
            <div style="display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px solid #eee;">
              <span>Credited IGST</span>
              <span>${formatINR(cn.igstPaise)}</span>
            </div>
          `
              : `
            <div style="display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px solid #eee;">
              <span>Credited CGST</span>
              <span>${formatINR(cn.cgstPaise)}</span>
            </div>
            <div style="display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px solid #eee;">
              <span>Credited SGST</span>
              <span>${formatINR(cn.sgstPaise)}</span>
            </div>
          `
          }
          <div style="display: flex; justify-content: space-between; padding: 8px 0; border-top: 2px solid #111; font-weight: 700; font-size: 15px;">
            <span>Total Credit</span>
            <span>${formatINR(cn.totalPaise)}</span>
          </div>
        </div>
      </div>
    `;
    })
    .join("");

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Credit Notes — Order #${escapeHtml(order.displayId)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #111; background: #fff; margin: 0; padding: 40px; }
    .container { max-width: 820px; margin: 0 auto; }
    @media print {
      body { padding: 0; }
      .no-print { display: none; }
    }
  </style>
</head>
<body>
  <div class="no-print" style="max-width: 820px; margin: 0 auto 20px; text-align: right;">
    <button onclick="window.print()" style="background: #111; color: #fff; border: none; padding: 10px 20px; font-size: 13px; font-weight: 500; cursor: pointer; border-radius: 4px;">
      🖨️ Print / Download PDF
    </button>
  </div>
  <div class="container">
    ${creditNotesHtml}
  </div>
</body>
</html>`;

  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'; img-src data: https:; script-src 'unsafe-inline'",
    },
  });
}
