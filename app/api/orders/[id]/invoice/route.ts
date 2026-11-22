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
      items: true,
      user: true,
      invoice: { include: { lines: true } },
    },
  });

  if (!order) {
    return new NextResponse("Order not found", { status: 404 });
  }

  // Guard: requires order owner or staff/owner
  if (order.userId !== userId && !isStaff) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  // Serve ONLY stored invoice
  const invoice = order.invoice;
  if (!invoice) {
    return new NextResponse("Invoice not available yet", {
      status: 404,
    });
  }

  const isReceipt = invoice.mode === "RECEIPT";
  const title = isReceipt ? "ORDER RECEIPT" : "TAX INVOICE";

  // Parse buyer address
  const rawBuyerAddr =
    typeof invoice.buyerAddress === "object" && invoice.buyerAddress !== null
      ? (invoice.buyerAddress as Record<string, string | undefined>)
      : {};

  const addr1 = escapeHtml(rawBuyerAddr.line1 || rawBuyerAddr.addressLine1 || rawBuyerAddr.street || "");
  const addr2 = escapeHtml(rawBuyerAddr.line2 || rawBuyerAddr.addressLine2 || "");
  const city = escapeHtml(rawBuyerAddr.city || "");
  const state = escapeHtml(invoice.buyerState || rawBuyerAddr.state || "");
  const pincode = escapeHtml(rawBuyerAddr.pincode || rawBuyerAddr.postalCode || "");
  const formattedAddressParts = [addr1, addr2, city, state, pincode].filter(Boolean);
  const formattedBuyerAddress = formattedAddressParts.join(", ");

  // Parse seller address
  const rawSellerAddr =
    typeof invoice.sellerAddress === "object" && invoice.sellerAddress !== null
      ? (invoice.sellerAddress as Record<string, string | undefined>)
      : {};
  const sellerAddrStr = escapeHtml(rawSellerAddr.address || "");
  const sellerPhone = escapeHtml(rawSellerAddr.phone || "");
  const sellerEmail = escapeHtml(rawSellerAddr.email || "");

  const invoiceDateStr = new Date(invoice.issuedAt).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  let linesHtml = "";
  if (isReceipt) {
    linesHtml = invoice.lines
      .map(
        (line, idx) => `
      <tr>
        <td style="padding: 10px; border-bottom: 1px solid #e5e5e5; font-size: 13px; text-align: center;">${idx + 1}</td>
        <td style="padding: 10px; border-bottom: 1px solid #e5e5e5; font-size: 13px;">${escapeHtml(line.description)}</td>
        <td style="padding: 10px; border-bottom: 1px solid #e5e5e5; font-size: 13px; text-align: center;">${escapeHtml(line.qty)}</td>
        <td style="padding: 10px; border-bottom: 1px solid #e5e5e5; font-size: 13px; text-align: right;">${formatINR(line.unitPaise)}</td>
        <td style="padding: 10px; border-bottom: 1px solid #e5e5e5; font-size: 13px; text-align: right; font-family: monospace;">${formatINR(line.netPaise)}</td>
      </tr>
    `
      )
      .join("");
  } else {
    // Tax Invoice line items
    linesHtml = invoice.lines
      .map(
        (line, idx) => `
      <tr>
        <td style="padding: 8px; border-bottom: 1px solid #e5e5e5; font-size: 12px; text-align: center;">${idx + 1}</td>
        <td style="padding: 8px; border-bottom: 1px solid #e5e5e5; font-size: 12px;">${escapeHtml(line.description)}</td>
        <td style="padding: 8px; border-bottom: 1px solid #e5e5e5; font-size: 12px; text-align: center;">${escapeHtml(line.hsn || "-")}</td>
        <td style="padding: 8px; border-bottom: 1px solid #e5e5e5; font-size: 12px; text-align: center;">${line.qty}</td>
        <td style="padding: 8px; border-bottom: 1px solid #e5e5e5; font-size: 12px; text-align: right;">${formatINR(line.unitPaise)}</td>
        <td style="padding: 8px; border-bottom: 1px solid #e5e5e5; font-size: 12px; text-align: right;">${line.discountPaise > 0 ? formatINR(line.discountPaise) : "-"}</td>
        <td style="padding: 8px; border-bottom: 1px solid #e5e5e5; font-size: 12px; text-align: right; font-weight: 500;">${formatINR(line.netPaise)}</td>
        <td style="padding: 8px; border-bottom: 1px solid #e5e5e5; font-size: 12px; text-align: center;">${Number(line.ratePercent)}%</td>
        <td style="padding: 8px; border-bottom: 1px solid #e5e5e5; font-size: 12px; text-align: right;">${formatINR(line.taxablePaise)}</td>
        ${
          invoice.isInterState
            ? `<td style="padding: 8px; border-bottom: 1px solid #e5e5e5; font-size: 12px; text-align: right;">${formatINR(line.igstPaise)}</td>`
            : `
          <td style="padding: 8px; border-bottom: 1px solid #e5e5e5; font-size: 12px; text-align: right;">${formatINR(line.cgstPaise)}</td>
          <td style="padding: 8px; border-bottom: 1px solid #e5e5e5; font-size: 12px; text-align: right;">${formatINR(line.sgstPaise)}</td>
        `
        }
      </tr>
    `
      )
      .join("");
  }

  const tableHeaderHtml = isReceipt
    ? `
      <tr>
        <th style="width: 40px; text-align: center;">#</th>
        <th>Item Description</th>
        <th style="width: 50px; text-align: center;">Qty</th>
        <th style="width: 90px; text-align: right;">Unit Price</th>
        <th style="width: 100px; text-align: right;">Total</th>
      </tr>
    `
    : `
      <tr>
        <th style="width: 30px; text-align: center;">#</th>
        <th>Item Description</th>
        <th style="width: 70px; text-align: center;">HSN</th>
        <th style="width: 40px; text-align: center;">Qty</th>
        <th style="width: 80px; text-align: right;">Price</th>
        <th style="width: 70px; text-align: right;">Disc.</th>
        <th style="width: 80px; text-align: right;">Net</th>
        <th style="width: 50px; text-align: center;">Rate</th>
        <th style="width: 85px; text-align: right;">Taxable</th>
        ${
          invoice.isInterState
            ? `<th style="width: 80px; text-align: right;">IGST</th>`
            : `
          <th style="width: 75px; text-align: right;">CGST</th>
          <th style="width: 75px; text-align: right;">SGST</th>
        `
        }
      </tr>
    `;

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)} ${escapeHtml(invoice.number || order.displayId)} — ${escapeHtml(invoice.sellerName)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #111; background: #fff; margin: 0; padding: 40px; }
    .container { max-width: 820px; margin: 0 auto; border: 1px solid #ddd; padding: 40px; border-radius: 4px; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #111; padding-bottom: 20px; margin-bottom: 25px; }
    .brand { font-size: 26px; font-weight: 700; letter-spacing: -0.02em; }
    .invoice-title { text-align: right; }
    .invoice-title h1 { margin: 0; font-size: 20px; font-weight: 700; letter-spacing: 0.05em; }
    .invoice-title p { margin: 4px 0 0; font-size: 13px; color: #333; font-family: monospace; font-weight: 600; }
    .details-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 25px; font-size: 13px; }
    .details-box { background: #faf9f6; padding: 14px; border-radius: 4px; border: 1px solid #eee; }
    .details-box h3 { margin: 0 0 8px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #666; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 25px; }
    th { background: #f0ede6; padding: 8px 10px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; text-align: left; border-bottom: 1px solid #ccc; }
    .totals { margin-left: auto; width: 320px; font-size: 13px; }
    .totals-row { display: flex; justify-content: space-between; padding: 5px 0; border-bottom: 1px solid #eee; }
    .totals-row.final { border-bottom: 2px solid #111; font-weight: 700; font-size: 15px; padding: 10px 0; }
    .notice { margin: 20px 0; font-size: 11px; color: #666; font-style: italic; }
    .footer { margin-top: 35px; text-align: center; font-size: 12px; color: #888; border-top: 1px solid #eee; padding-top: 15px; }
    @media print {
      body { padding: 0; }
      .container { border: none; padding: 0; max-width: 100%; }
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
    <div class="header">
      <div>
        <div class="brand">${escapeHtml(invoice.sellerName)}</div>
        ${sellerAddrStr ? `<p style="margin: 4px 0 0; font-size: 11px; color: #555;">${sellerAddrStr}</p>` : ""}
        ${invoice.sellerState ? `<p style="margin: 2px 0 0; font-size: 11px; color: #555;">State: ${escapeHtml(invoice.sellerState)}</p>` : ""}
        ${sellerPhone ? `<p style="margin: 2px 0 0; font-size: 11px; color: #555;">Phone: ${sellerPhone}</p>` : ""}
        ${sellerEmail ? `<p style="margin: 2px 0 0; font-size: 11px; color: #555;">Email: ${sellerEmail}</p>` : ""}
        ${!isReceipt && invoice.sellerGstin ? `<p style="margin: 4px 0 0; font-size: 12px; color: #111; font-family: monospace; font-weight: 600;">GSTIN: ${escapeHtml(invoice.sellerGstin)}</p>` : ""}
      </div>
      <div class="invoice-title">
        <h1>${escapeHtml(title)}</h1>
        <p>${escapeHtml(invoice.number || `#${order.displayId}`)}</p>
        <p style="margin-top: 4px; font-size: 12px; color: #555; font-family: sans-serif;">
          Date: ${invoiceDateStr}
        </p>
        <p style="margin-top: 2px; font-size: 11px; color: #555; font-family: sans-serif;">
          Order Ref: #${escapeHtml(order.displayId)}
        </p>
        ${!isReceipt && invoice.placeOfSupply ? `<p style="margin-top: 2px; font-size: 11px; color: #555; font-family: sans-serif;">Place of Supply: <strong>${escapeHtml(invoice.placeOfSupply)}</strong></p>` : ""}
      </div>
    </div>

    <div class="details-grid">
      <div class="details-box">
        <h3>Billed / Shipped To</h3>
        <p style="margin: 0; font-weight: 600;">${escapeHtml(invoice.buyerName)}</p>
        <p style="margin: 4px 0 0;">${formattedBuyerAddress || "Standard Delivery"}</p>
        ${order.customerEmail ? `<p style="margin: 4px 0 0; color: #555;">${escapeHtml(order.customerEmail)}</p>` : ""}
        ${order.customerPhone ? `<p style="margin: 2px 0 0; color: #555;">Phone: ${escapeHtml(order.customerPhone)}</p>` : ""}
        ${!isReceipt && invoice.buyerGstin ? `<p style="margin: 4px 0 0; font-family: monospace;">GSTIN: ${escapeHtml(invoice.buyerGstin)}</p>` : ""}
      </div>
      <div class="details-box">
        <h3>Order & Payment Details</h3>
        <p style="margin: 0;">Payment Method: <strong>${order.paymentMethod === "COD" ? "Cash on Delivery" : "Prepaid Online"}</strong></p>
        ${order.razorpayPaymentId ? `<p style="margin: 4px 0 0; font-family: monospace; font-size: 11px; color: #555;">Payment ID: ${escapeHtml(order.razorpayPaymentId)}</p>` : ""}
        <p style="margin: 4px 0 0; font-size: 11px; color: #555;">Fulfilment: <strong>${escapeHtml(order.fulfilmentStatus)}</strong></p>
        ${order.courierName ? `<p style="margin: 2px 0 0; font-size: 11px; color: #555;">Courier: ${escapeHtml(order.courierName)} (${escapeHtml(order.awbNumber || "")})</p>` : ""}
      </div>
    </div>

    <table>
      <thead>
        ${tableHeaderHtml}
      </thead>
      <tbody>
        ${linesHtml}
      </tbody>
    </table>

    <div class="totals">
      ${
        isReceipt
          ? `
        <div class="totals-row">
          <span>Total Amount</span>
          <span>${formatINR(invoice.totalPaise)}</span>
        </div>
      `
          : `
        <div class="totals-row">
          <span>Taxable Value</span>
          <span>${formatINR(invoice.taxablePaise)}</span>
        </div>
        ${
          invoice.isInterState
            ? `
          <div class="totals-row">
            <span>IGST</span>
            <span>${formatINR(invoice.igstPaise)}</span>
          </div>
        `
            : `
          <div class="totals-row">
            <span>CGST</span>
            <span>${formatINR(invoice.cgstPaise)}</span>
          </div>
          <div class="totals-row">
            <span>SGST</span>
            <span>${formatINR(invoice.sgstPaise)}</span>
          </div>
        `
        }
        <div class="totals-row">
          <span>Total Tax</span>
          <span>${formatINR(invoice.cgstPaise + invoice.sgstPaise + invoice.igstPaise)}</span>
        </div>
        <div class="totals-row final">
          <span>Total (GST Inclusive)</span>
          <span>${formatINR(invoice.totalPaise)}</span>
        </div>
      `
      }
    </div>

    <div class="notice">
      ${isReceipt ? "Order receipt generated for customer reference. GST not applicable." : "All prices are GST-inclusive. Tax is extracted in compliance with Indian GST regulations."}
    </div>

    <div class="footer">
      Thank you for shopping with ${escapeHtml(invoice.sellerName)}.${sellerEmail ? ` For any assistance, reach out to ${sellerEmail}.` : ""}
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
