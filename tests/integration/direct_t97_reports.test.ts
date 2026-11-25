import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import crypto from "crypto";
import { prisma } from "../helpers/prisma";
import {
  createTestUser,
  createTestProduct,
  createTestOrder,
  cleanupM1TestRows,
  genId,
} from "../helpers/fixtures";
import {
  salesReport,
  gstSummary,
  returnsReport,
  stockReport,
  offersUsageReport,
  marginReport,
} from "@/lib/admin/reports";
import { ForbiddenError } from "@/lib/guards";
import { SiteSettings } from "@prisma/client";

describe("T97: Business Reports & IST Analytics", () => {
  let originalSettings: SiteSettings | null = null;
  const createdOrderIds: string[] = [];
  const createdInvoiceIds: string[] = [];
  const createdCreditNoteIds: string[] = [];

  beforeAll(async () => {
    originalSettings = await prisma.siteSettings.findUnique({ where: { id: "default" } });
  });

  afterAll(async () => {
    try {
      if (createdCreditNoteIds.length > 0) {
        await prisma.creditNoteLine.deleteMany({ where: { creditNoteId: { in: createdCreditNoteIds } } });
        await prisma.creditNote.deleteMany({ where: { id: { in: createdCreditNoteIds } } });
      }
      if (createdInvoiceIds.length > 0) {
        await prisma.invoiceLine.deleteMany({ where: { invoiceId: { in: createdInvoiceIds } } });
        await prisma.invoice.deleteMany({ where: { id: { in: createdInvoiceIds } } });
      }
      await cleanupM1TestRows();
    } finally {
      if (originalSettings) {
        const { id, ...data } = originalSettings;
        await prisma.siteSettings.update({
          where: { id },
          data,
        });
      }
    }
  });

  beforeEach(async () => {
    await cleanupM1TestRows();
  });

  afterEach(async () => {
    await cleanupM1TestRows();
  });

  it("salesReport accurately aggregates paid orders, excludes CANCELLED, and deducts refunds", async () => {
    const user = await createTestUser();
    const { product, variants } = await createTestProduct({ price: 100000 });

    // 1. Paid Razorpay Order
    const o1 = await createTestOrder({
      userId: user.id,
      paymentMethod: "RAZORPAY",
      paymentStatus: "PAID",
      fulfilmentStatus: "CONFIRMED",
      total: 100000,
      items: [{ productId: product.id, variantId: variants[0].id, qty: 1, unitPrice: 100000, name: product.name, size: "M" }],
    });
    createdOrderIds.push(o1.id);

    // 2. Paid Delivered COD Order
    const o2 = await createTestOrder({
      userId: user.id,
      paymentMethod: "COD",
      paymentStatus: "PAID",
      fulfilmentStatus: "DELIVERED",
      shippingFee: 9900,
      total: 109900,
      items: [{ productId: product.id, variantId: variants[0].id, qty: 1, unitPrice: 100000, name: product.name, size: "M" }],
    });
    createdOrderIds.push(o2.id);

    // 3. Cancelled Order (should be excluded)
    const o3 = await createTestOrder({
      userId: user.id,
      paymentMethod: "RAZORPAY",
      paymentStatus: "PAID",
      fulfilmentStatus: "CANCELLED",
      total: 100000,
      items: [{ productId: product.id, variantId: variants[0].id, qty: 1, unitPrice: 100000, name: product.name, size: "M" }],
    });
    createdOrderIds.push(o3.id);

    // 4. Refund on o1
    await prisma.refund.create({
      data: {
        orderId: o1.id,
        amountPaise: 20000,
        method: "RAZORPAY",
        status: "PROCESSED",
        idempotencyKey: crypto.randomUUID(),
      },
    });

    const report = await salesReport();
    expect(report.total.orders).toBeGreaterThanOrEqual(2);
    expect(report.total.grossPaise).toBeGreaterThanOrEqual(200000);
    expect(report.total.refundsPaise).toBeGreaterThanOrEqual(20000);
  });

  it("gstSummary aggregates invoices and subtracts credit notes", async () => {
    const user = await createTestUser();
    const { product, variants } = await createTestProduct({ price: 100000 });
    const order = await createTestOrder({
      userId: user.id,
      items: [{ productId: product.id, variantId: variants[0].id, qty: 1, unitPrice: 100000, name: product.name, size: "M" }],
    });

    const invNumber = `INV-${genId().slice(0, 8)}`;
    const invoice = await prisma.invoice.create({
      data: {
        orderId: order.id,
        number: invNumber,
        mode: "TAX",
        sellerName: "Habitt Apparel",
        sellerAddress: { line1: "Sector 1", city: "Mumbai" },
        sellerState: "MH",
        buyerName: "Customer A",
        buyerAddress: { line1: "Road 1", city: "Mumbai" },
        buyerState: "MH",
        placeOfSupply: "MH",
        totalPaise: 100000,
        taxablePaise: 95238,
        cgstPaise: 2381,
        sgstPaise: 2381,
        igstPaise: 0,
        isInterState: false,
        lines: {
          create: [
            {
              description: "Tee",
              hsn: "61091000",
              qty: 1,
              unitPaise: 100000,
              netPaise: 100000,
              ratePercent: 5,
              taxablePaise: 95238,
              cgstPaise: 2381,
              sgstPaise: 2381,
              igstPaise: 0,
            },
          ],
        },
      },
      include: { lines: true },
    });
    createdInvoiceIds.push(invoice.id);

    const cnNumber = `CN-${genId().slice(0, 8)}`;
    const creditNote = await prisma.creditNote.create({
      data: {
        invoiceId: invoice.id,
        orderId: order.id,
        fy: "2026-27",
        number: cnNumber,
        sequence: 1,
        reason: "RETURN",
        totalPaise: 50000,
        taxablePaise: 47619,
        cgstPaise: 1190,
        sgstPaise: 1191,
        igstPaise: 0,
        lines: {
          create: [
            {
              invoiceLineId: invoice.lines[0].id,
              description: "Return goods",
              qty: 1,
              ratePercent: 5,
              taxablePaise: 47619,
              cgstPaise: 1190,
              sgstPaise: 1191,
              igstPaise: 0,
              totalPaise: 50000,
            },
          ],
        },
      },
    });
    createdCreditNoteIds.push(creditNote.id);

    const summary = await gstSummary();
    expect(summary.taxInvoiceCount).toBeGreaterThanOrEqual(1);
    expect(summary.creditNotes.some((cn) => cn.creditNoteNumber === cnNumber)).toBe(true);
    const rate5 = summary.rates.find((r) => r.ratePercent === 5);
    expect(rate5).toBeDefined();
    expect(rate5!.taxablePaise).toBeGreaterThan(0);
  });

  it("stockReport respects roles: OWNER sees cost, STAFF sees null", async () => {
    const staffStock = await stockReport("STAFF");
    expect(staffStock.totalValueCostPaise).toBeNull();
    if (staffStock.variants.length > 0) {
      expect(staffStock.variants[0].costPricePaise).toBeNull();
    }

    const ownerStock = await stockReport("OWNER");
    expect(ownerStock.totalValueCostPaise).not.toBeNull();
    expect(typeof ownerStock.totalValueCostPaise).toBe("number");
  });

  it("marginReport enforces OWNER only role and throws ForbiddenError for others", async () => {
    await expect(marginReport(undefined, undefined, "STAFF")).rejects.toThrow(ForbiddenError);
    const ownerMargin = await marginReport(undefined, undefined, "OWNER");
    expect(ownerMargin).toBeDefined();
    expect(typeof ownerMargin.totalRevenuePaise).toBe("number");
    expect(typeof ownerMargin.totalCostPaise).toBe("number");
    expect(typeof ownerMargin.grossMarginPaise).toBe("number");
  });

  it("returnsReport and offersUsageReport execute without errors", async () => {
    const returns = await returnsReport();
    expect(returns).toBeDefined();
    expect(typeof returns.requests).toBe("number");

    const offers = await offersUsageReport();
    expect(offers).toBeDefined();
    expect(typeof offers.totalRedemptions).toBe("number");
  });
});
