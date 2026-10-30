import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/sessions";
import { prisma } from "@/lib/prisma";
import { formatINR } from "@/lib/money";
import { getSettings } from "@/lib/settings";
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
    include: { items: true, user: true },
  });

  if (!order) {
    return new NextResponse("Order not found", { status: 404 });
  }

  // Guard: requires order owner or staff/owner
  if (order.userId !== userId && !isStaff) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const address =
    typeof order.shippingAddress === "object" && order.shippingAddress !== null
      ? (order.shippingAddress as Record<string, string | undefined>)
      : {};

  const addressLine1 = escapeHtml(address.addressLine1 || address.street || address.line1 || "");
  const addressLine2 = escapeHtml(address.addressLine2 || address.line2 || "");
  const city = escapeHtml(address.city || "");
  const state = escapeHtml(address.state || "");
  const pincode = escapeHtml(address.pincode || address.postalCode || "");

  const formattedAddressParts = [addressLine1, addressLine2, city, state, pincode].filter(Boolean);
  const formattedAddress = formattedAddressParts.join(", ");

  const itemsRows = order.items
    .map(
      (item) => `
      <tr>
        <td style="padding: 10px; border-bottom: 1px solid #e5e5e5; font-size: 13px;">${escapeHtml(item.name)} (${escapeHtml(item.size)})</td>
        <td style="padding: 10px; border-bottom: 1px solid #e5e5e5; font-size: 13px; text-align: center;">${escapeHtml(item.qty)}</td>
        <td style="padding: 10px; border-bottom: 1px solid #e5e5e5; font-size: 13px; text-align: right;">${formatINR(item.unitPrice)}</td>
        <td style="padding: 10px; border-bottom: 1px solid #e5e5e5; font-size: 13px; text-align: right; font-family: monospace;">${formatINR(item.unitPrice * item.qty)}</td>
      </tr>
    `
    )
    .join("");

  const settings = await getSettings();

  const hasGst = Boolean(settings.gstEnabled && settings.gstin && settings.gstin.trim().length > 0);
  const invoiceTitle = hasGst ? "TAX INVOICE" : "ORDER RECEIPT";

  const gstAmount =
    hasGst && settings.gstRate > 0
      ? Math.round((order.subtotal * settings.gstRate) / 100)
      : 0;

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(invoiceTitle)} #${escapeHtml(order.displayId)} — ${escapeHtml(settings.businessName)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #111; background: #fff; margin: 0; padding: 40px; }
    .container { max-width: 700px; margin: 0 auto; border: 1px solid #ddd; padding: 40px; border-radius: 4px; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #111; padding-bottom: 20px; margin-bottom: 30px; }
    .brand { font-size: 28px; font-weight: 700; letter-spacing: -0.02em; font-style: italic; }
    .tagline { font-size: 11px; color: #666; text-transform: uppercase; letter-spacing: 0.1em; }
    .invoice-title { text-align: right; }
    .invoice-title h1 { margin: 0; font-size: 22px; font-weight: 600; }
    .invoice-title p { margin: 4px 0 0; font-size: 12px; color: #666; font-family: monospace; }
    .details-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 30px; font-size: 13px; }
    .details-box { background: #faf9f6; padding: 15px; border-radius: 4px; border: 1px solid #eee; }
    .details-box h3 { margin: 0 0 8px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #666; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
    th { background: #f0ede6; padding: 10px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; text-align: left; border-bottom: 1px solid #ccc; }
    .totals { margin-left: auto; width: 250px; font-size: 13px; }
    .totals-row { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #eee; }
    .totals-row.final { border-bottom: 2px solid #111; font-weight: 700; font-size: 15px; padding: 10px 0; }
    .footer { margin-top: 40px; text-align: center; font-size: 12px; color: #888; border-top: 1px solid #eee; padding-top: 20px; }
    @media print {
      body { padding: 0; }
      .container { border: none; padding: 0; }
      .no-print { display: none; }
    }
  </style>
</head>
<body>
  <div class="no-print" style="max-width: 700px; margin: 0 auto 20px; text-align: right;">
    <button onclick="window.print()" style="background: #111; color: #fff; border: none; padding: 10px 20px; font-size: 13px; font-weight: 500; cursor: pointer; border-radius: 4px;">
      🖨️ Print / Download PDF
    </button>
  </div>

  <div class="container">
    <div class="header">
      <div>
        <div class="brand">${escapeHtml(settings.legalName || settings.businessName)}</div>
        <div class="tagline">${escapeHtml(settings.businessTagline)}</div>
        ${settings.businessAddress ? `<p style="margin: 4px 0 0; font-size: 11px; color: #555;">${escapeHtml(settings.businessAddress)}</p>` : ""}
        ${settings.businessPhone ? `<p style="margin: 2px 0 0; font-size: 11px; color: #555;">Phone: ${escapeHtml(settings.businessPhone)}</p>` : ""}
        ${hasGst ? `<p style="margin: 2px 0 0; font-size: 11px; color: #555; font-family: monospace;">GSTIN: ${escapeHtml(settings.gstin)}</p>` : ""}
      </div>
      <div class="invoice-title">
        <h1>${escapeHtml(invoiceTitle)}</h1>
        <p>#${escapeHtml(order.displayId)}</p>
        <p style="margin-top: 4px; font-size: 11px; color: #444;">
          Date: ${new Date(order.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
        </p>
      </div>
    </div>

    <div class="details-grid">
      <div class="details-box">
        <h3>Billed To (Customer)</h3>
        <p style="margin: 0; font-weight: 600;">${escapeHtml(order.customerName)}</p>
        <p style="margin: 4px 0 0;">${escapeHtml(order.customerEmail || order.user?.email || "")}</p>
        <p style="margin: 2px 0 0;">${escapeHtml(order.customerPhone)}</p>
      </div>
      <div class="details-box">
        <h3>Shipping Destination</h3>
        <p style="margin: 0;">${formattedAddress || "Standard Shipping"}</p>
        ${order.razorpayPaymentId ? `<p style="margin: 8px 0 0; font-family: monospace; font-size: 11px; color: #555;">Payment ID: ${escapeHtml(order.razorpayPaymentId)}</p>` : ""}
        <p style="margin: 4px 0 0; font-size: 11px; color: #555;">Payment Method: <strong>${order.paymentMethod === "COD" ? "Cash on Delivery" : "Prepaid Online"}</strong></p>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th>Item Description</th>
          <th style="text-align: center;">Qty</th>
          <th style="text-align: right;">Unit Price</th>
          <th style="text-align: right;">Amount</th>
        </tr>
      </thead>
      <tbody>
        ${itemsRows}
      </tbody>
    </table>

    <div class="totals">
      <div class="totals-row">
        <span>Subtotal</span>
        <span>${formatINR(order.subtotal)}</span>
      </div>
      ${
        hasGst && gstAmount > 0
          ? `
        <div class="totals-row">
          <span>GST (${escapeHtml(settings.gstRate)}%)</span>
          <span>${formatINR(gstAmount)}</span>
        </div>
      `
          : ""
      }
      <div class="totals-row">
        <span>Shipping Fee</span>
        <span>${order.shippingFee === 0 ? "FREE" : formatINR(order.shippingFee)}</span>
      </div>
      <div class="totals-row final">
        <span>Total Paid</span>
        <span>${formatINR(order.total)}</span>
      </div>
    </div>

    ${
      order.razorpayRefundId
        ? `
      <div style="margin-top: 20px; padding: 12px; background: #fef2f2; border: 1px solid #fca5a5; border-radius: 4px; color: #991b1b; font-size: 12px;">
        <strong>Refund Status:</strong> Order Cancelled & Refunded (Ref: ${escapeHtml(order.razorpayRefundId)})
      </div>
    `
        : ""
    }

    <div class="footer">
      Thank you for shopping with ${escapeHtml(settings.businessName)}.${settings.supportEmail ? ` For questions, contact ${escapeHtml(settings.supportEmail)}.` : ""}
    </div>
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
