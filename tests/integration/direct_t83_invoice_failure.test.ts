import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import {
  createTestUser,
  createTestProduct,
  createTestOrder,
  cleanupM1TestRows,
} from "../helpers/fixtures";
import * as guardsModule from "@/lib/guards";
import * as issueInvoiceModule from "@/lib/gst/issue-invoice";
import * as creditNoteModule from "@/lib/gst/credit-note";
import { markOrderShipped } from "@/lib/actions/fulfillment";
import { approveReturn } from "@/lib/actions/returns";
import {
  retryInvoiceIssueAction,
  retryCreditNoteIssueAction,
} from "@/lib/actions/gst";

describe("T83: Invoice and Credit Note Failure Resilience & Admin Retry", () => {
  beforeAll(async () => {
    await cleanupM1TestRows();
    const staffUser = await createTestUser({ role: "STAFF" });
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

    // Ensure GST is active
    await prisma.siteSettings.upsert({
      where: { id: "default" },
      create: {
        id: "default",
        gstEnabled: true,
        gstRate: 18.0,
        gstin: "32AAAAA0000A1Z5",
        businessName: "Habitt Apparels",
        businessState: "Kerala",
        invoicePrefix: "HB",
      },
      update: {
        gstEnabled: true,
        gstRate: 18.0,
        gstin: "32AAAAA0000A1Z5",
        businessName: "Habitt Apparels",
        businessState: "Kerala",
        invoicePrefix: "HB",
      },
    });
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await cleanupM1TestRows();
  });

  it("with issueInvoiceForOrder forced to throw, markOrderShipped still succeeds, order is SHIPPED, INVOICE PENDING note exists, and retry creates one invoice", async () => {
    const user = await createTestUser();
    const { product, variants } = await createTestProduct({ price: 150000 });

    const order = await createTestOrder({
      userId: user.id,
      paymentStatus: "PAID",
      fulfilmentStatus: "PLACED",
      paymentMethod: "RAZORPAY",
      items: [
        {
          variantId: variants[0].id,
          productId: product.id,
          qty: 1,
          unitPrice: 150000,
          name: product.name,
          size: "M",
        },
      ],
      total: 150000,
    });

    // Force issueInvoiceForOrder to throw
    const invSpy = vi
      .spyOn(issueInvoiceModule, "issueInvoiceForOrder")
      .mockRejectedValueOnce(new Error("Simulated invoice generation failure"));

    // markOrderShipped must not throw
    await expect(
      markOrderShipped(order.id, {
        courierName: "Delhivery",
        awbNumber: "AWB-T83-FAIL",
      })
    ).resolves.not.toThrow();

    // Verify order is SHIPPED
    const updatedOrder = await prisma.order.findUnique({
      where: { id: order.id },
      include: {
        invoice: true,
        statusEvents: { orderBy: { createdAt: "desc" } },
      },
    });

    expect(updatedOrder?.fulfilmentStatus).toBe("SHIPPED");
    expect(updatedOrder?.invoice).toBeNull();

    // Verify INVOICE PENDING note exists
    const pendingEvent = updatedOrder?.statusEvents.find((e) =>
      e.note?.includes("INVOICE PENDING")
    );
    expect(pendingEvent).toBeDefined();

    // Restore spy and execute admin retry
    invSpy.mockRestore();

    const retryResult = await retryInvoiceIssueAction(order.id);
    expect(retryResult.success).toBe(true);
    expect(retryResult.invoice).toBeDefined();

    // Verify exactly one invoice exists
    const invoices = await prisma.invoice.findMany({
      where: { orderId: order.id },
    });
    expect(invoices).toHaveLength(1);
    expect(invoices[0].number).toMatch(/^HB\/\d{4}-\d{2}\/\d{5}$/);

    // Repeated retry should be idempotent
    const secondRetry = await retryInvoiceIssueAction(order.id);
    expect(secondRetry.success).toBe(true);
    const invoicesAfterSecond = await prisma.invoice.findMany({
      where: { orderId: order.id },
    });
    expect(invoicesAfterSecond).toHaveLength(1);
  });

  it("with createCreditNoteForRefund forced to throw on approveReturn, return is approved, refund recorded, CREDIT NOTE PENDING note exists, and retry creates note once", async () => {
    const user = await createTestUser();
    const { product, variants } = await createTestProduct({ price: 200000 });

    const order = await createTestOrder({
      userId: user.id,
      paymentStatus: "PAID",
      fulfilmentStatus: "DELIVERED",
      paymentMethod: "COD",
      items: [
        {
          variantId: variants[0].id,
          productId: product.id,
          qty: 1,
          unitPrice: 200000,
          name: product.name,
          size: "L",
        },
      ],
      total: 200000,
    });

    // Create an initial invoice for the order so credit notes can be issued
    await prisma.$transaction(async (tx) => {
      await issueInvoiceModule.issueInvoiceForOrder(tx, order.id);
    });

    // Create a ReturnRequest
    const returnReq = await prisma.returnRequest.create({
      data: {
        orderId: order.id,
        userId: user.id,
        reason: "Wrong fit",
        status: "REQUESTED",
      },
    });

    // Force createCreditNoteForRefund to throw
    const cnSpy = vi
      .spyOn(creditNoteModule, "createCreditNoteForRefund")
      .mockRejectedValueOnce(new Error("Simulated credit note failure"));

    // approveReturn must succeed despite credit note failure
    await expect(
      approveReturn(returnReq.id, "Approved customer return")
    ).resolves.not.toThrow();

    // Check returnRequest is refunded and order is cancelled
    const updatedReturnReq = await prisma.returnRequest.findUnique({
      where: { id: returnReq.id },
    });
    expect(updatedReturnReq?.status).toBe("REFUNDED");

    const updatedOrder = await prisma.order.findUnique({
      where: { id: order.id },
      include: {
        creditNotes: true,
        statusEvents: { orderBy: { createdAt: "desc" } },
      },
    });

    expect(updatedOrder?.fulfilmentStatus).toBe("CANCELLED");
    expect(updatedOrder?.creditNotes).toHaveLength(0);

    // Verify CREDIT NOTE PENDING note exists with refundRef
    const pendingCnEvent = updatedOrder?.statusEvents.find(
      (e) =>
        e.note?.includes("CREDIT NOTE PENDING") &&
        e.note?.includes(`refundRef=${returnReq.id}`)
    );
    expect(pendingCnEvent).toBeDefined();

    // Restore spy and execute admin retry
    cnSpy.mockRestore();

    const retryResult = await retryCreditNoteIssueAction(order.id, returnReq.id);
    expect(retryResult.success).toBe(true);
    expect(retryResult.creditNote).toBeDefined();

    // Verify exactly one credit note exists
    const creditNotes = await prisma.creditNote.findMany({
      where: { orderId: order.id },
    });
    expect(creditNotes).toHaveLength(1);
    expect(creditNotes[0].refundRef).toBe(returnReq.id);
    expect(creditNotes[0].number).toMatch(/^HB\/CN\/\d{4}-\d{2}\/\d{5}$/);

    // Repeated retry is idempotent
    const secondRetry = await retryCreditNoteIssueAction(order.id, returnReq.id);
    expect(secondRetry.success).toBe(true);
    const creditNotesAfterSecond = await prisma.creditNote.findMany({
      where: { orderId: order.id },
    });
    expect(creditNotesAfterSecond).toHaveLength(1);
  });
});
