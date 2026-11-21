import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { prisma } from "../helpers/prisma";
import {
  createTestUser,
  createTestProduct,
  createTestOrder,
  cleanupM1TestRows,
} from "../helpers/fixtures";
import { issueInvoiceForOrder } from "@/lib/gst/issue-invoice";
import { createCreditNoteForRefund } from "@/lib/gst/credit-note";
import { SiteSettings } from "@prisma/client";

describe("T82: Credit Notes Proportional Calculation and Cap Enforcement", () => {
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
    await prisma.siteSettings.upsert({
      where: { id: "default" },
      create: {
        id: "default",
        gstEnabled: true,
        gstRate: 18.0,
        gstin: "32AAAAA0000A1Z5",
        gstFeeMode: "COMPOSITE",
        gstFeeRate: 18.0,
        invoicePrefix: "HB",
        businessState: "Kerala",
      },
      update: {
        gstEnabled: true,
        gstRate: 18.0,
        gstin: "32AAAAA0000A1Z5",
        gstFeeMode: "COMPOSITE",
        gstFeeRate: 18.0,
        invoicePrefix: "HB",
        businessState: "Kerala",
      },
    });
  });

  afterEach(async () => {
    // Keep DB clean
  });

  it("1. Generates proportional partial credit note for specific returned items", async () => {
    const user = await createTestUser();
    const { product, variants } = await createTestProduct({ price: 100000 });

    const order = await createTestOrder({
      userId: user.id,
      items: [{ productId: product.id, variantId: variants[0].id, qty: 2, unitPrice: 100000 }],
      status: "PAID",
      total: 200000,
    });

    await prisma.$transaction((tx) => issueInvoiceForOrder(tx, order.id));
    const item = order.items[0];

    // Return 1 of 2 items
    const cn = await prisma.$transaction((tx) =>
      createCreditNoteForRefund(tx, {
        orderId: order.id,
        refundedItems: [{ orderItemId: item.id, qty: 1 }],
        reason: "Customer returned 1 item",
        refundRef: "refund-part-1",
      })
    );

    expect(cn).not.toBeNull();
    expect(cn!.number).toMatch(/^HB\/CN\/\d{4}-\d{2}\/\d{5}$/);
    expect(cn!.totalPaise).toBe(100000); // Exactly half of 200,000
    expect(cn!.lines).toHaveLength(1);
    expect(cn!.lines[0].qty).toBe(1);
    expect(cn!.lines[0].totalPaise).toBe(100000);
    expect(cn!.taxablePaise + cn!.cgstPaise + cn!.sgstPaise + cn!.igstPaise).toBe(100000);
  });

  it("2. Cumulative cap: multiple partial credit notes cannot exceed remaining invoice amount", async () => {
    const user = await createTestUser();
    const { product, variants } = await createTestProduct({ price: 100000 });

    const order = await createTestOrder({
      userId: user.id,
      items: [{ productId: product.id, variantId: variants[0].id, qty: 1, unitPrice: 100000 }],
      status: "PAID",
      total: 100000,
    });

    await prisma.$transaction((tx) => issueInvoiceForOrder(tx, order.id));

    // First credit note: 60000 paise (Rs 600)
    const cn1 = await prisma.$transaction((tx) =>
      createCreditNoteForRefund(tx, {
        orderId: order.id,
        refundAmountPaise: 60000,
        reason: "Partial refund 1",
        refundRef: "ref-1",
      })
    );
    expect(cn1!.totalPaise).toBe(60000);

    // Second credit note: requests 50000 paise (Rs 500), but remaining is only 40000 (Rs 400)
    const cn2 = await prisma.$transaction((tx) =>
      createCreditNoteForRefund(tx, {
        orderId: order.id,
        refundAmountPaise: 50000,
        reason: "Partial refund 2",
        refundRef: "ref-2",
      })
    );
    expect(cn2!.totalPaise).toBe(40000); // Strictly capped to remaining creditable amount

    // Third credit note: 0 remaining creditable -> returns null
    const cn3 = await prisma.$transaction((tx) =>
      createCreditNoteForRefund(tx, {
        orderId: order.id,
        refundAmountPaise: 10000,
        reason: "Attempt over-credit",
        refundRef: "ref-3",
      })
    );
    expect(cn3).toBeNull();
  });

  it("3. Idempotency per refundRef: repeated calls return existing credit note", async () => {
    const user = await createTestUser();
    const { product, variants } = await createTestProduct({ price: 50000 });

    const order = await createTestOrder({
      userId: user.id,
      items: [{ productId: product.id, variantId: variants[0].id, qty: 1, unitPrice: 50000 }],
      status: "PAID",
      total: 50000,
    });

    await prisma.$transaction((tx) => issueInvoiceForOrder(tx, order.id));

    const first = await prisma.$transaction((tx) =>
      createCreditNoteForRefund(tx, {
        orderId: order.id,
        refundAmountPaise: 50000,
        reason: "Return",
        refundRef: "idempotent-ref-1",
      })
    );

    const second = await prisma.$transaction((tx) =>
      createCreditNoteForRefund(tx, {
        orderId: order.id,
        refundAmountPaise: 50000,
        reason: "Return duplicate",
        refundRef: "idempotent-ref-1",
      })
    );

    expect(second!.id).toBe(first!.id);
    expect(second!.number).toBe(first!.number);
  });

  it("4. RECEIPT mode: no credit note is issued for orders in receipt mode", async () => {
    await prisma.siteSettings.update({
      where: { id: "default" },
      data: { gstEnabled: false },
    });

    const user = await createTestUser();
    const { product, variants } = await createTestProduct({ price: 80000 });

    const order = await createTestOrder({
      userId: user.id,
      items: [{ productId: product.id, variantId: variants[0].id, qty: 1, unitPrice: 80000 }],
      status: "PAID",
      total: 80000,
    });

    const receipt = await prisma.$transaction((tx) => issueInvoiceForOrder(tx, order.id));
    expect(receipt.mode).toBe("RECEIPT");

    // Attempt to issue credit note
    const cn = await prisma.$transaction((tx) =>
      createCreditNoteForRefund(tx, {
        orderId: order.id,
        refundAmountPaise: 80000,
        reason: "Receipt return",
      })
    );

    expect(cn).toBeNull();
  });

  it("5. Pre-shipment cancellation: order without an invoice produces no credit note", async () => {
    const user = await createTestUser();
    const { product, variants } = await createTestProduct({ price: 120000 });

    const order = await createTestOrder({
      userId: user.id,
      items: [{ productId: product.id, variantId: variants[0].id, qty: 1, unitPrice: 120000 }],
      status: "PAID",
      total: 120000,
    });

    // Notice: invoice NOT issued (pre-shipment)
    const cn = await prisma.$transaction((tx) =>
      createCreditNoteForRefund(tx, {
        orderId: order.id,
        refundAmountPaise: 120000,
        reason: "Pre-shipment cancel",
      })
    );

    expect(cn).toBeNull();
  });
});
