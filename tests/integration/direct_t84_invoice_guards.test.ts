import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

vi.mock("@/lib/sessions", () => ({
  getSessionUser: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import {
  createTestUser,
  createTestProduct,
  createTestOrder,
  cleanupM1TestRows,
} from "../helpers/fixtures";
import * as guardsModule from "@/lib/guards";
import { getSessionUser } from "@/lib/sessions";
import {
  issueInvoiceForOrder,
  InvoiceNotAllowedError,
} from "@/lib/gst/issue-invoice";
import { createCreditNoteForRefund } from "@/lib/gst/credit-note";
import {
  updateGstSettings,
  createPartialCreditNoteAction,
} from "@/lib/actions/gst";
import { GET as getInvoiceRoute } from "@/app/api/orders/[id]/invoice/route";
import { NextRequest } from "next/server";
import { SiteSettings } from "@prisma/client";

describe("T84: Invoice and Credit Note Guards, Validation, and Invariants", () => {
  let staffUser: { id: string; email: string | null };
  let originalSettings: SiteSettings | null = null;

  beforeAll(async () => {
    originalSettings = await prisma.siteSettings.findUnique({ where: { id: "default" } });
    await cleanupM1TestRows();
    staffUser = await createTestUser({ role: "STAFF" });
    vi.spyOn(guardsModule, "requireStaff").mockResolvedValue({
      id: staffUser.id,
      role: "STAFF",
      email: staffUser.email,
    });
    vi.spyOn(guardsModule, "requireRole").mockResolvedValue({
      id: staffUser.id,
      role: "STAFF",
      email: staffUser.email,
    });

    // Clean rule setup
    await prisma.gstRule.deleteMany({});
    await prisma.gstRule.create({
      data: {
        name: "Standard 18% Rule",
        ratePercent: 18.0,
        minUnitPaise: 0,
        active: true,
      },
    });

    await prisma.siteSettings.upsert({
      where: { id: "default" },
      create: {
        id: "default",
        gstEnabled: true,
        gstRate: 18.0,
        gstin: "03AAAAA0000A1Z5",
        businessName: "Habitt Apparels",
        businessState: "Punjab",
        invoicePrefix: "HB",
        gstFeeMode: "SEPARATE",
        gstFeeRate: 18.0,
      },
      update: {
        gstEnabled: true,
        gstRate: 18.0,
        gstin: "03AAAAA0000A1Z5",
        businessName: "Habitt Apparels",
        businessState: "Punjab",
        invoicePrefix: "HB",
        gstFeeMode: "SEPARATE",
        gstFeeRate: 18.0,
      },
    });
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await cleanupM1TestRows();
  });

  it("1. Issuing refused for PENDING, CANCELLED, FAILED, and PLACED-not-yet-shipped orders; no counter incremented", async () => {
    const user = await createTestUser();
    const { product, variants } = await createTestProduct({ price: 100000 });

    const orderPlaced = await createTestOrder({
      userId: user.id,
      items: [{ productId: product.id, variantId: variants[0].id, qty: 1, unitPrice: 100000 }],
      paymentStatus: "PAID",
      fulfilmentStatus: "PLACED",
      paymentMethod: "RAZORPAY",
    });

    const orderPending = await createTestOrder({
      userId: user.id,
      items: [{ productId: product.id, variantId: variants[0].id, qty: 1, unitPrice: 100000 }],
      paymentStatus: "PENDING",
      fulfilmentStatus: "CREATED",
      paymentMethod: "RAZORPAY",
    });

    const orderCancelled = await createTestOrder({
      userId: user.id,
      items: [{ productId: product.id, variantId: variants[0].id, qty: 1, unitPrice: 100000 }],
      paymentStatus: "REFUNDED",
      fulfilmentStatus: "CANCELLED",
      paymentMethod: "RAZORPAY",
    });

    const orderFailed = await createTestOrder({
      userId: user.id,
      items: [{ productId: product.id, variantId: variants[0].id, qty: 1, unitPrice: 100000 }],
      paymentStatus: "FAILED",
      fulfilmentStatus: "CREATED",
      paymentMethod: "RAZORPAY",
    });

    // Record initial counter
    const initialCounter = await prisma.invoiceCounter.findFirst({
      where: { fy: { startsWith: "INV-" } },
    });
    const initialLast = initialCounter?.lastNumber ?? 0;

    await expect(
      prisma.$transaction((tx) => issueInvoiceForOrder(tx, orderPlaced.id))
    ).rejects.toThrow(InvoiceNotAllowedError);

    await expect(
      prisma.$transaction((tx) => issueInvoiceForOrder(tx, orderPending.id))
    ).rejects.toThrow(InvoiceNotAllowedError);

    await expect(
      prisma.$transaction((tx) => issueInvoiceForOrder(tx, orderCancelled.id))
    ).rejects.toThrow(InvoiceNotAllowedError);

    await expect(
      prisma.$transaction((tx) => issueInvoiceForOrder(tx, orderFailed.id))
    ).rejects.toThrow(InvoiceNotAllowedError);

    // Verify counter was not incremented
    const afterCounter = await prisma.invoiceCounter.findFirst({
      where: { fy: { startsWith: "INV-" } },
    });
    expect(afterCounter?.lastNumber ?? 0).toBe(initialLast);
  });

  it("2. Financial year of invoice derived from shippedAt (31 March vs 1 April landing in different FYs)", async () => {
    const user = await createTestUser();
    const { product, variants } = await createTestProduct({ price: 100000 });

    // 31 March 2026 -> FY 2025-26
    const marchShippedAt = new Date("2026-03-31T12:00:00.000Z");
    const orderMarch = await createTestOrder({
      userId: user.id,
      items: [{ productId: product.id, variantId: variants[0].id, qty: 1, unitPrice: 100000 }],
      status: "SHIPPED",
      shippedAt: marchShippedAt,
    });

    // 1 April 2026 -> FY 2026-27
    const aprilShippedAt = new Date("2026-04-01T12:00:00.000Z");
    const orderApril = await createTestOrder({
      userId: user.id,
      items: [{ productId: product.id, variantId: variants[0].id, qty: 1, unitPrice: 100000 }],
      status: "SHIPPED",
      shippedAt: aprilShippedAt,
    });

    const invoiceMarch = await prisma.$transaction((tx) =>
      issueInvoiceForOrder(tx, orderMarch.id)
    );
    const invoiceApril = await prisma.$transaction((tx) =>
      issueInvoiceForOrder(tx, orderApril.id)
    );

    expect(invoiceMarch.fy).toBe("2025-26");
    expect(invoiceMarch.number).toContain("/2025-26/");

    expect(invoiceApril.fy).toBe("2026-27");
    expect(invoiceApril.number).toContain("/2026-27/");
  });

  it("3. GET invoice for order with no invoice returns 404 and creates no invoice", async () => {
    const user = await createTestUser();
    const { product, variants } = await createTestProduct({ price: 100000 });

    const order = await createTestOrder({
      userId: user.id,
      items: [{ productId: product.id, variantId: variants[0].id, qty: 1, unitPrice: 100000 }],
      status: "PAID", // Unshipped
    });

    vi.mocked(getSessionUser).mockResolvedValueOnce({
      id: user.id,
      role: "CUSTOMER",
      email: user.email,
      name: user.name,
      phone: user.phone,
      sid: "dummy-sid",
      stepUpAt: null,
    });

    const req = new NextRequest(`http://localhost:3000/api/orders/${order.id}/invoice`);
    const res = await getInvoiceRoute(req, { params: Promise.resolve({ id: order.id }) });

    expect(res.status).toBe(404);
    const body = await res.text();
    expect(body).toBe("Invoice not available yet");

    // Verify invoice was NOT created
    const count = await prisma.invoice.count({ where: { orderId: order.id } });
    expect(count).toBe(0);
  });

  it("4. Enabling GST without gstin/state/name/rule rejected; succeeds when all present", async () => {
    // 4a. Attempt enabling with missing GSTIN
    await expect(
      updateGstSettings({
        gstEnabled: true,
        gstRate: 18.0,
        gstin: null,
        gstFeeMode: "COMPOSITE",
        gstFeeRate: 18.0,
        invoicePrefix: "HB",
        businessState: "Punjab",
      })
    ).rejects.toThrow("Cannot enable GST. Missing required configuration");

    // 4b. Attempt enabling with invalid / missing state
    await expect(
      updateGstSettings({
        gstEnabled: true,
        gstRate: 18.0,
        gstin: "03AAAAA0000A1Z5",
        gstFeeMode: "COMPOSITE",
        gstFeeRate: 18.0,
        invoicePrefix: "HB",
        businessState: "InvalidStateXYZ",
      })
    ).rejects.toThrow("Cannot enable GST. Missing required configuration");

    // 4c. Attempt disabling/deleting the last active rule while GST is enabled
    const activeRules = await prisma.gstRule.findMany({ where: { active: true } });
    expect(activeRules.length).toBeGreaterThan(0);
    // If only 1 rule, deleting or toggling it should fail
    if (activeRules.length === 1) {
      const { toggleGstRuleActive, deleteGstRule } = await import("@/lib/actions/gst");
      await expect(toggleGstRuleActive(activeRules[0].id)).rejects.toThrow(
        "Cannot delete/deactivate last active rule while GST is enabled"
      );
      await expect(deleteGstRule(activeRules[0].id)).rejects.toThrow(
        "Cannot delete/deactivate last active rule while GST is enabled"
      );
    }

    // 4d. Valid update succeeds
    const successResult = await updateGstSettings({
      gstEnabled: true,
      gstRate: 18.0,
      gstin: "03AAAAA0000A1Z5",
      gstFeeMode: "SEPARATE",
      gstFeeRate: 18.0,
      invoicePrefix: "HB",
      businessState: "Punjab",
    });
    expect(successResult.success).toBe(true);
    expect(successResult.settings.gstEnabled).toBe(true);
    expect(successResult.settings.businessState).toBe("Punjab");
  });

  it("5. Full-refund credit note includes fee share and cannot exceed invoice total", async () => {
    const user = await createTestUser();
    const { product, variants } = await createTestProduct({ price: 100000 });

    const order = await createTestOrder({
      userId: user.id,
      items: [{ productId: product.id, variantId: variants[0].id, qty: 1, unitPrice: 100000 }],
      status: "SHIPPED",
      shippingFee: 10000, // 100 Rs shipping fee in SEPARATE mode
      total: 110000,
    });

    const invoice = await prisma.$transaction((tx) =>
      issueInvoiceForOrder(tx, order.id)
    );
    expect(invoice.totalPaise).toBe(110000);
    expect(invoice.lines.some((l) => l.kind === "SHIPPING")).toBe(true);

    // Full refund: refundedItems covers all items
    const creditNote = await prisma.$transaction((tx) =>
      createCreditNoteForRefund(tx, {
        orderId: order.id,
        reason: "Full customer cancellation",
        refundRef: "t84-full-refund",
        refundedItems: [{ orderItemId: order.items[0].id, qty: 1 }],
        includeFeeShare: true,
      })
    );

    expect(creditNote).not.toBeNull();
    // Total of credit note must equal total invoice (goods 100000 + shipping 10000 = 110000)
    expect(creditNote!.totalPaise).toBe(110000);
    expect(creditNote!.lines.some((l) => l.kind === "SHIPPING")).toBe(true);
    expect(creditNote!.totalPaise).toBeLessThanOrEqual(invoice.totalPaise);

    // A second credit note attempt must find remaining creditable = 0 and return null
    const secondCn = await prisma.$transaction((tx) =>
      createCreditNoteForRefund(tx, {
        orderId: order.id,
        reason: "Second refund attempt",
        refundRef: "t84-second-refund",
        refundAmountPaise: 10000,
      })
    );
    expect(secondCn).toBeNull();
  });

  it("6. Partial credit note action respects cap, rejects qty 0 and over-qty, writes AuditLog", async () => {
    const user = await createTestUser();
    const { product, variants } = await createTestProduct({ price: 50000 });

    const order = await createTestOrder({
      userId: user.id,
      items: [{ productId: product.id, variantId: variants[0].id, qty: 3, unitPrice: 50000 }],
      status: "SHIPPED",
      shippingFee: 0,
      total: 150000,
    });

    const invoice = await prisma.$transaction((tx) =>
      issueInvoiceForOrder(tx, order.id)
    );

    // 6a. Rejects qty 0 for all items
    await expect(
      createPartialCreditNoteAction({
        orderId: order.id,
        items: [{ orderItemId: order.items[0].id, qty: 0 }],
        reason: "Zero quantity test",
      })
    ).rejects.toThrow("At least one item must have a quantity greater than 0");

    // 6b. Rejects over-quantity (ordered 3, requesting 5)
    await expect(
      createPartialCreditNoteAction({
        orderId: order.id,
        items: [{ orderItemId: order.items[0].id, qty: 5 }],
        reason: "Over-quantity test",
      })
    ).rejects.toThrow("exceeds remaining uncredited quantity");

    // 6c. Valid partial credit of 2 items
    const res = await createPartialCreditNoteAction({
      orderId: order.id,
      items: [{ orderItemId: order.items[0].id, qty: 2 }],
      reason: "2 damaged items returned",
    });

    expect(res.success).toBe(true);
    expect(res.creditNote.totalPaise).toBe(100000);

    // 6d. Verifying AuditLog was written
    const audit = await prisma.auditLog.findFirst({
      where: {
        action: "CREDIT_NOTE_CREATE_PARTIAL",
        entityId: res.creditNote.id,
      },
    });
    expect(audit).not.toBeNull();
    expect(audit!.actorId).toBe(staffUser.id);

    // 6e. Now remaining uncredited qty is 1. Requesting 2 must fail.
    await expect(
      createPartialCreditNoteAction({
        orderId: order.id,
        items: [{ orderItemId: order.items[0].id, qty: 2 }],
        reason: "Requesting more than remaining uncredited qty",
      })
    ).rejects.toThrow("exceeds remaining uncredited quantity (1)");

    // 6f. Requesting remaining 1 succeeds
    const resFinal = await createPartialCreditNoteAction({
      orderId: order.id,
      items: [{ orderItemId: order.items[0].id, qty: 1 }],
      reason: "Remaining 1 item returned",
    });
    expect(resFinal.success).toBe(true);
    expect(resFinal.creditNote.totalPaise).toBe(50000);

    // Total credited = 100000 + 50000 = 150000 = invoice.totalPaise
    const totalCredited = await prisma.creditNote.aggregate({
      where: { invoiceId: invoice.id },
      _sum: { totalPaise: true },
    });
    expect(totalCredited._sum.totalPaise).toBe(150000);
  });

  afterAll(async () => {
    try {
      if (originalSettings) {
        const { id: _id, updatedAt: _up, ...rest } = originalSettings;
        void _id;
        void _up;
        await prisma.siteSettings.upsert({
          where: { id: "default" },
          create: { id: "default", ...rest },
          update: { ...rest },
        });
      }
    } finally {
      await cleanupM1TestRows();
    }
  });
});
