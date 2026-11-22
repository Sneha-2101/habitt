import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { prisma } from "../helpers/prisma";
import {
  createTestUser,
  createTestProduct,
  createTestOrder,
  cleanupM1TestRows,
} from "../helpers/fixtures";
import { issueInvoiceForOrder } from "@/lib/gst/issue-invoice";
import { SiteSettings } from "@prisma/client";

describe("T81: GST Invoice Generation, Sequencing and Tax Integrity", () => {
  let originalSettings: SiteSettings | null = null;

  beforeAll(async () => {
    originalSettings = await prisma.siteSettings.findUnique({ where: { id: "default" } });
    await cleanupM1TestRows();
  });

  afterAll(async () => {
    if (originalSettings) {
      await prisma.siteSettings.update({
        where: { id: "default" },
        data: {
          gstEnabled: originalSettings.gstEnabled,
          gstRate: originalSettings.gstRate,
          gstin: originalSettings.gstin,
          gstFeeMode: originalSettings.gstFeeMode,
          gstFeeRate: originalSettings.gstFeeRate,
          invoicePrefix: originalSettings.invoicePrefix,
          businessState: originalSettings.businessState,
        },
      });
    }
    await cleanupM1TestRows();
  });

  beforeEach(async () => {
    // Default test settings: GST enabled, Punjab seller
    await prisma.siteSettings.upsert({
      where: { id: "default" },
      create: {
        id: "default",
        gstEnabled: true,
        gstRate: 18.0,
        gstin: "03AAAAA0000A1Z5",
        gstFeeMode: "COMPOSITE",
        gstFeeRate: 18.0,
        invoicePrefix: "HB",
        businessState: "Punjab",
      },
      update: {
        gstEnabled: true,
        gstRate: 18.0,
        gstin: "03AAAAA0000A1Z5",
        gstFeeMode: "COMPOSITE",
        gstFeeRate: 18.0,
        invoicePrefix: "HB",
        businessState: "Punjab",
      },
    });
  });

  afterEach(async () => {
    // Keep DB clean
  });

  it("1. Issues invoice automatically on shipment and creates gapless sequential numbers", async () => {
    const user = await createTestUser({ role: "STAFF" });
    const { product, variants } = await createTestProduct({ price: 199900 });

    const order1 = await createTestOrder({
      userId: user.id,
      items: [{ productId: product.id, variantId: variants[0].id, qty: 1, unitPrice: 199900 }],
      status: "SHIPPED",
      shippingAddress: {
        fullName: "Test Customer",
        line1: "Mall Road",
        city: "Ludhiana",
        state: "Punjab",
        pincode: "141001",
      },
    });

    const invoice1 = await prisma.$transaction(async (tx) => {
      return issueInvoiceForOrder(tx, order1.id);
    });

    expect(invoice1.mode).toBe("TAX");
    expect(invoice1.number).toMatch(/^HB\/\d{4}-\d{2}\/\d{5}$/);
    expect(invoice1.sellerGstin).toBe("03AAAAA0000A1Z5");
    expect(invoice1.sellerState).toBe("Punjab");
    expect(invoice1.isInterState).toBe(false); // Same state Punjab -> intra-state
    expect(invoice1.cgstPaise).toBeGreaterThan(0);
    expect(invoice1.sgstPaise).toBeGreaterThan(0);
    expect(invoice1.igstPaise).toBe(0);
    expect(invoice1.cgstPaise + invoice1.sgstPaise).toBe(invoice1.totalPaise - invoice1.taxablePaise);

    // Second order gets consecutive number
    const order2 = await createTestOrder({
      userId: user.id,
      items: [{ productId: product.id, variantId: variants[0].id, qty: 1, unitPrice: 199900 }],
      status: "SHIPPED",
      shippingAddress: {
        fullName: "Test Customer 2",
        line1: "Brigade Road",
        city: "Bengaluru",
        state: "Karnataka",
        pincode: "560001",
      },
    });

    const invoice2 = await prisma.$transaction(async (tx) => {
      return issueInvoiceForOrder(tx, order2.id);
    });

    expect(invoice2.sequence).toBe((invoice1.sequence || 0) + 1);
    expect(invoice2.isInterState).toBe(true); // Punjab -> Karnataka inter-state
    expect(invoice2.igstPaise).toBeGreaterThan(0);
    expect(invoice2.cgstPaise).toBe(0);
    expect(invoice2.sgstPaise).toBe(0);
  });

  it("2. Idempotency: re-issuing an invoice for the same order returns the existing record without incrementing counter", async () => {
    const user = await createTestUser();
    const { product, variants } = await createTestProduct({ price: 99900 });

    const order = await createTestOrder({
      userId: user.id,
      items: [{ productId: product.id, variantId: variants[0].id, qty: 1, unitPrice: 99900 }],
      status: "SHIPPED",
    });

    const first = await prisma.$transaction((tx) => issueInvoiceForOrder(tx, order.id));
    const second = await prisma.$transaction((tx) => issueInvoiceForOrder(tx, order.id));

    expect(second.id).toBe(first.id);
    expect(second.number).toBe(first.number);
    expect(second.sequence).toBe(first.sequence);

    // Verify counter was not incremented
    const orderNext = await createTestOrder({
      userId: user.id,
      items: [{ productId: product.id, variantId: variants[0].id, qty: 1, unitPrice: 99900 }],
      status: "SHIPPED",
    });
    const nextInv = await prisma.$transaction((tx) => issueInvoiceForOrder(tx, orderNext.id));
    expect(nextInv.sequence).toBe((first.sequence || 0) + 1);
  });

  it("3. Gapless numbers across parallel concurrent invoice issues", async () => {
    const user = await createTestUser();
    const { product, variants } = await createTestProduct({ price: 100000 });

    const orders = await Promise.all(
      Array.from({ length: 5 }).map(() =>
        createTestOrder({
          userId: user.id,
          items: [{ productId: product.id, variantId: variants[0].id, qty: 1, unitPrice: 100000 }],
          status: "SHIPPED",
        })
      )
    );

    // Issue all 5 simultaneously
    const invoices = await Promise.all(
      orders.map((o) =>
        prisma.$transaction((tx) => issueInvoiceForOrder(tx, o.id))
      )
    );

    const sequences = invoices.map((inv) => inv.sequence!).sort((a, b) => a - b);
    expect(sequences).toHaveLength(5);

    // Every sequence must be strictly sequential (next = prev + 1)
    for (let i = 1; i < sequences.length; i++) {
      expect(sequences[i]).toBe(sequences[i - 1] + 1);
    }

    // Numbers must be unique
    const numbers = new Set(invoices.map((inv) => inv.number));
    expect(numbers.size).toBe(5);
  });

  it("4. RECEIPT mode: when gstEnabled is false, issues RECEIPT with null number and does not consume counter", async () => {
    await prisma.siteSettings.update({
      where: { id: "default" },
      data: { gstEnabled: false },
    });

    const user = await createTestUser();
    const { product, variants } = await createTestProduct({ price: 150000 });

    const order = await createTestOrder({
      userId: user.id,
      items: [{ productId: product.id, variantId: variants[0].id, qty: 1, unitPrice: 150000 }],
      status: "SHIPPED",
    });

    const receipt = await prisma.$transaction((tx) => issueInvoiceForOrder(tx, order.id));

    expect(receipt.mode).toBe("RECEIPT");
    expect(receipt.number).toBeNull();
    expect(receipt.sequence).toBeNull();
    expect(receipt.fy).toBeNull();
    expect(receipt.sellerGstin).toBeNull(); // GSTIN hidden in receipt mode
    expect(receipt.cgstPaise).toBe(0);
    expect(receipt.sgstPaise).toBe(0);
    expect(receipt.igstPaise).toBe(0);
    expect(receipt.taxablePaise).toBe(order.total);
    expect(receipt.totalPaise).toBe(order.total);
  });

  it("5. Gift lines appear at net 0 with 0 tax and do not distort order total", async () => {
    const user = await createTestUser();
    const { product, variants } = await createTestProduct({ price: 200000 });
    const { product: giftProd, variants: giftVariants } = await createTestProduct({ price: 50000 });

    const order = await createTestOrder({
      userId: user.id,
      items: [
        { productId: product.id, variantId: variants[0].id, name: product.name, qty: 1, unitPrice: 200000 },
        { productId: giftProd.id, variantId: giftVariants[0].id, name: giftProd.name, qty: 1, unitPrice: 0, isGift: true },
      ],
      status: "SHIPPED",
      shippingFee: 0,
      total: 200000,
    });

    const invoice = await prisma.$transaction((tx) => issueInvoiceForOrder(tx, order.id));
    const giftLine = invoice.lines.find((l) => l.description.includes(giftProd.name));

    expect(giftLine).toBeDefined();
    expect(giftLine!.netPaise).toBe(0);
    expect(giftLine!.taxablePaise).toBe(0);
    expect(giftLine!.cgstPaise).toBe(0);
    expect(giftLine!.sgstPaise).toBe(0);
    expect(giftLine!.igstPaise).toBe(0);
    expect(invoice.totalPaise).toBe(200000);
  });

  it("6. Stored invoice remains unchanged even if SiteSettings are later modified", async () => {
    const user = await createTestUser();
    const { product, variants } = await createTestProduct({ price: 199900 });

    const order = await createTestOrder({
      userId: user.id,
      items: [{ productId: product.id, variantId: variants[0].id, qty: 1, unitPrice: 199900 }],
      status: "SHIPPED",
    });

    const invoice = await prisma.$transaction((tx) => issueInvoiceForOrder(tx, order.id));
    const originalNumber = invoice.number;
    const originalTaxable = invoice.taxablePaise;
    const originalSellerGstin = invoice.sellerGstin;

    // Mutate settings drastically
    await prisma.siteSettings.update({
      where: { id: "default" },
      data: {
        gstRate: 28.0,
        gstin: "99BBBBB9999B9Z9",
        businessName: "Totally Different Name",
        invoicePrefix: "XYZ",
      },
    });

    // Re-fetch invoice directly from DB
    const persisted = await prisma.invoice.findUnique({
      where: { id: invoice.id },
      include: { lines: true },
    });

    expect(persisted!.number).toBe(originalNumber);
    expect(persisted!.taxablePaise).toBe(originalTaxable);
    expect(persisted!.sellerGstin).toBe(originalSellerGstin);
    expect(persisted!.sellerName).toBe(invoice.sellerName);
  });
});
