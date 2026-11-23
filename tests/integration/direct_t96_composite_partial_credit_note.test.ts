import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "../helpers/prisma";
import {
  createTestUser,
  createTestProduct,
  createTestOrder,
} from "../helpers/fixtures";
import { issueInvoiceForOrder } from "@/lib/gst/issue-invoice";
import { requestReturn, approveReturn, receiveReturn, refundReturn } from "@/lib/actions/returns";
import { SiteSettings } from "@prisma/client";

let mockCurrentUser: { id: string; role: string } = { id: "default_user", role: "STAFF" };
const mockRefund = vi.fn();

vi.mock("@/lib/guards", () => ({
  requireUser: vi.fn(async () => mockCurrentUser),
  requireStaff: vi.fn(async () => mockCurrentUser),
  requireRole: vi.fn(),
}));

vi.mock("@/lib/razorpay", () => ({
  getRazorpay: () => ({
    payments: {
      refund: mockRefund,
    },
  }),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

describe("T96: COMPOSITE partial credit note and fee share on final return", () => {
  let originalSettings: SiteSettings | null = null;
  let createdRuleId: string | null = null;

  beforeAll(async () => {
    originalSettings = await prisma.siteSettings.findUnique({
      where: { id: "default" },
    });

    await prisma.siteSettings.upsert({
      where: { id: "default" },
      update: {
        gstEnabled: true,
        gstFeeMode: "COMPOSITE",
        gstFeeRate: 18.0,
        gstRate: 18.0,
        gstin: "03AAAAA0000A1Z5",
        invoicePrefix: "HB",
        businessState: "Punjab",
      },
      create: {
        id: "default",
        gstEnabled: true,
        gstFeeMode: "COMPOSITE",
        gstFeeRate: 18.0,
        gstRate: 18.0,
        gstin: "03AAAAA0000A1Z5",
        invoicePrefix: "HB",
        businessState: "Punjab",
      },
    });

    // Ensure an active GST rule exists
    const activeRule = await prisma.gstRule.findFirst({
      where: { active: true },
    });

    if (!activeRule) {
      const created = await prisma.gstRule.create({
        data: {
          name: "m1test_default_rule",
          ratePercent: 18.0,
          active: true,
        },
      });
      createdRuleId = created.id;
    }
  });

  afterAll(async () => {
    if (createdRuleId) {
      await prisma.gstRule.delete({ where: { id: createdRuleId } }).catch(() => {});
    }

    if (originalSettings) {
      const { id: _id, updatedAt: _up, ...rest } = originalSettings;
      void _id;
      void _up;
      await prisma.siteSettings.upsert({
        where: { id: "default" },
        update: { ...rest },
        create: { id: "default", ...rest },
      });
    }
  });

  it("1. COMPOSITE mode: partial return credit note equals item price only (100000), final return includes remaining fee share so sum equals invoice total exactly", async () => {
    const user = await createTestUser();
    mockCurrentUser = { id: user.id, role: "STAFF" };

    const { product: prod1, variants: var1 } = await createTestProduct({ price: 100000 });
    const { product: prod2, variants: var2 } = await createTestProduct({ price: 120000 });

    const order = await createTestOrder({
      userId: user.id,
      items: [
        { variantId: var1[0].id, productId: prod1.id, qty: 1, unitPrice: 100000 },
        { variantId: var2[0].id, productId: prod2.id, qty: 1, unitPrice: 120000 },
      ],
      shippingFee: 9900,
      total: 229900,
      status: "DELIVERED",
      paymentMethod: "RAZORPAY",
      razorpayPaymentId: "pay_m1test_comp_multi",
      paidAt: new Date(),
      deliveredAt: new Date(),
    });

    // Issue initial tax invoice for the order
    await prisma.$transaction(async (tx) => {
      await issueInvoiceForOrder(tx, order.id);
    });

    const invoice = await prisma.invoice.findUnique({
      where: { orderId: order.id },
      include: { lines: true },
    });
    expect(invoice).not.toBeNull();
    expect(invoice!.totalPaise).toBe(229900);
    // In COMPOSITE mode, shipping fee is spread onto goods lines, so 2 goods lines and 0 separate fee lines
    expect(invoice!.lines.filter((l) => l.kind === "GOODS")).toHaveLength(2);
    expect(invoice!.lines.filter((l) => l.kind !== "GOODS")).toHaveLength(0);

    // --- Return 1: Item 1 only (partial return) ---
    const req1 = await requestReturn({
      orderId: order.id,
      items: [{ orderItemId: order.items[0].id, qty: 1 }],
      reasonCode: "WRONG_SIZE",
    });

    await approveReturn(req1.id);
    const itms1 = await prisma.returnItem.findMany({ where: { returnId: req1.id } });
    await receiveReturn(req1.id, [{ returnItemId: itms1[0].id, restock: true }]);

    mockRefund.mockResolvedValueOnce({ id: "rfnd_comp_part_1" });
    await refundReturn(req1.id);

    // Mid-order check: Order payment status is PARTIALLY_REFUNDED
    const midOrder = await prisma.order.findUnique({
      where: { id: order.id },
      include: { refunds: true, creditNotes: { include: { lines: true } } },
    });
    expect(midOrder?.paymentStatus).toBe("PARTIALLY_REFUNDED");
    expect(midOrder?.refundAmount).toBe(100000); // exactly item 1 amount
    expect(midOrder?.creditNotes).toHaveLength(1);
    expect(midOrder?.creditNotes[0].totalPaise).toBe(100000); // credit note total matches cash refund 100000 exactly!
    expect(midOrder?.creditNotes[0].totalPaise).toBeLessThanOrEqual(invoice!.totalPaise);

    // --- Return 2: Item 2 (completes full order return) ---
    const req2 = await requestReturn({
      orderId: order.id,
      items: [{ orderItemId: order.items[1].id, qty: 1 }],
      reasonCode: "CHANGED_MIND",
    });

    await approveReturn(req2.id);
    const itms2 = await prisma.returnItem.findMany({ where: { returnId: req2.id } });
    await receiveReturn(req2.id, [{ returnItemId: itms2[0].id, restock: true }]);

    mockRefund.mockResolvedValueOnce({ id: "rfnd_comp_part_2" });
    await refundReturn(req2.id);

    // Final order check: Order payment status is REFUNDED
    const finalOrder = await prisma.order.findUnique({
      where: { id: order.id },
      include: { refunds: true, creditNotes: { include: { lines: true } } },
    });
    expect(finalOrder?.paymentStatus).toBe("REFUNDED");
    expect(finalOrder?.refundAmount).toBe(229900); // 100000 + 120000 + 9900 = 229900

    expect(finalOrder?.creditNotes).toHaveLength(2);
    const totalCreditNotesPaise = finalOrder?.creditNotes.reduce((s, cn) => s + cn.totalPaise, 0);
    // Invariant 1: Sum of credit notes equals invoice total exactly
    expect(totalCreditNotesPaise).toBe(229900);
    expect(totalCreditNotesPaise).toBe(invoice!.totalPaise);

    // Invariant 2: Sum of credit notes never exceeded invoice total at any point
    const cn1Total = finalOrder!.creditNotes[0].totalPaise;
    const cn2Total = finalOrder!.creditNotes[1].totalPaise;
    expect(cn1Total).toBe(100000);
    expect(cn2Total).toBe(129900); // 120000 item + 9900 fee share
    expect(cn1Total + cn2Total).toBe(229900);

    // Invariant 3: Cumulative cash refunds sum exactly to order total
    const totalRefunded = finalOrder?.refunds.reduce((s, r) => s + r.amountPaise, 0);
    expect(totalRefunded).toBe(229900);
  });

  it("2. COD order with COD fee: full return in two partial returns, invariant holds", async () => {
    const user = await createTestUser({ storeCreditBalance: 0 });
    mockCurrentUser = { id: user.id, role: "STAFF" };

    const { product: prod1, variants: var1 } = await createTestProduct({ price: 100000 });
    const { product: prod2, variants: var2 } = await createTestProduct({ price: 120000 });

    const order = await createTestOrder({
      userId: user.id,
      items: [
        { variantId: var1[0].id, productId: prod1.id, qty: 1, unitPrice: 100000 },
        { variantId: var2[0].id, productId: prod2.id, qty: 1, unitPrice: 120000 },
      ],
      shippingFee: 9900,
      codFee: 5000,
      total: 234900, // 100000 + 120000 + 9900 + 5000
      status: "DELIVERED",
      paymentMethod: "COD",
      paidAt: new Date(),
      deliveredAt: new Date(),
    });

    // Issue initial tax invoice for the COD order
    await prisma.$transaction(async (tx) => {
      await issueInvoiceForOrder(tx, order.id);
    });

    const invoice = await prisma.invoice.findUnique({
      where: { orderId: order.id },
      include: { lines: true },
    });
    expect(invoice).not.toBeNull();
    expect(invoice!.totalPaise).toBe(234900);

    // --- Return 1: Item 1 only (partial return) ---
    const req1 = await requestReturn({
      orderId: order.id,
      items: [{ orderItemId: order.items[0].id, qty: 1 }],
      reasonCode: "DEFECTIVE",
    });

    await approveReturn(req1.id);
    const itms1 = await prisma.returnItem.findMany({ where: { returnId: req1.id } });
    await receiveReturn(req1.id, [{ returnItemId: itms1[0].id, restock: false }]);

    await refundReturn(req1.id);

    const midOrder = await prisma.order.findUnique({
      where: { id: order.id },
      include: { refunds: true, creditNotes: true },
    });
    expect(midOrder?.paymentStatus).toBe("PARTIALLY_REFUNDED");
    expect(midOrder?.refundAmount).toBe(100000);
    expect(midOrder?.creditNotes).toHaveLength(1);
    expect(midOrder?.creditNotes[0].totalPaise).toBe(100000);

    // --- Return 2: Item 2 (final return, completes full return) ---
    const req2 = await requestReturn({
      orderId: order.id,
      items: [{ orderItemId: order.items[1].id, qty: 1 }],
      reasonCode: "OTHER",
    });

    await approveReturn(req2.id);
    const itms2 = await prisma.returnItem.findMany({ where: { returnId: req2.id } });
    await receiveReturn(req2.id, [{ returnItemId: itms2[0].id, restock: false }]);

    await refundReturn(req2.id);

    const finalOrder = await prisma.order.findUnique({
      where: { id: order.id },
      include: { refunds: true, creditNotes: true },
    });
    expect(finalOrder?.paymentStatus).toBe("REFUNDED");
    expect(finalOrder?.refundAmount).toBe(234900); // 100000 + 120000 + 9900 + 5000 = 234900

    expect(finalOrder?.creditNotes).toHaveLength(2);
    const totalCreditNotesPaise = finalOrder?.creditNotes.reduce((s, cn) => s + cn.totalPaise, 0);
    expect(totalCreditNotesPaise).toBe(234900);
    expect(totalCreditNotesPaise).toBe(invoice!.totalPaise);

    const cn1Total = finalOrder!.creditNotes[0].totalPaise;
    const cn2Total = finalOrder!.creditNotes[1].totalPaise;
    expect(cn1Total).toBe(100000);
    expect(cn2Total).toBe(134900); // 120000 + 9900 + 5000 = 134900
    expect(cn1Total + cn2Total).toBe(234900);
  });

  it("3. SEPARATE mode: keeps its current amounts (partial 100000, final 129900)", async () => {
    // Switch to SEPARATE mode
    await prisma.siteSettings.update({
      where: { id: "default" },
      data: { gstFeeMode: "SEPARATE" },
    });

    const user = await createTestUser();
    mockCurrentUser = { id: user.id, role: "STAFF" };

    const { product: prod1, variants: var1 } = await createTestProduct({ price: 100000 });
    const { product: prod2, variants: var2 } = await createTestProduct({ price: 120000 });

    const order = await createTestOrder({
      userId: user.id,
      items: [
        { variantId: var1[0].id, productId: prod1.id, qty: 1, unitPrice: 100000 },
        { variantId: var2[0].id, productId: prod2.id, qty: 1, unitPrice: 120000 },
      ],
      shippingFee: 9900,
      total: 229900,
      status: "DELIVERED",
      paymentMethod: "RAZORPAY",
      razorpayPaymentId: "pay_m1test_sep_multi",
      paidAt: new Date(),
      deliveredAt: new Date(),
    });

    await prisma.$transaction(async (tx) => {
      await issueInvoiceForOrder(tx, order.id);
    });

    const invoice = await prisma.invoice.findUnique({
      where: { orderId: order.id },
      include: { lines: true },
    });
    expect(invoice).not.toBeNull();
    expect(invoice!.totalPaise).toBe(229900);
    // In SEPARATE mode, fee lines are separate
    expect(invoice!.lines.filter((l) => l.kind === "GOODS")).toHaveLength(2);
    expect(invoice!.lines.filter((l) => l.kind === "SHIPPING")).toHaveLength(1);

    // --- Return 1: Item 1 only (partial return) ---
    const req1 = await requestReturn({
      orderId: order.id,
      items: [{ orderItemId: order.items[0].id, qty: 1 }],
      reasonCode: "WRONG_SIZE",
    });

    await approveReturn(req1.id);
    const itms1 = await prisma.returnItem.findMany({ where: { returnId: req1.id } });
    await receiveReturn(req1.id, [{ returnItemId: itms1[0].id, restock: true }]);

    mockRefund.mockResolvedValueOnce({ id: "rfnd_sep_part_1" });
    await refundReturn(req1.id);

    const midOrder = await prisma.order.findUnique({
      where: { id: order.id },
      include: { refunds: true, creditNotes: true },
    });
    expect(midOrder?.paymentStatus).toBe("PARTIALLY_REFUNDED");
    expect(midOrder?.refundAmount).toBe(100000);
    expect(midOrder?.creditNotes).toHaveLength(1);
    expect(midOrder?.creditNotes[0].totalPaise).toBe(100000);

    // --- Return 2: Item 2 (final return) ---
    const req2 = await requestReturn({
      orderId: order.id,
      items: [{ orderItemId: order.items[1].id, qty: 1 }],
      reasonCode: "CHANGED_MIND",
    });

    await approveReturn(req2.id);
    const itms2 = await prisma.returnItem.findMany({ where: { returnId: req2.id } });
    await receiveReturn(req2.id, [{ returnItemId: itms2[0].id, restock: true }]);

    mockRefund.mockResolvedValueOnce({ id: "rfnd_sep_part_2" });
    await refundReturn(req2.id);

    const finalOrder = await prisma.order.findUnique({
      where: { id: order.id },
      include: { refunds: true, creditNotes: true },
    });
    expect(finalOrder?.paymentStatus).toBe("REFUNDED");
    expect(finalOrder?.refundAmount).toBe(229900);

    expect(finalOrder?.creditNotes).toHaveLength(2);
    const totalCreditNotesPaise = finalOrder?.creditNotes.reduce((s, cn) => s + cn.totalPaise, 0);
    expect(totalCreditNotesPaise).toBe(229900);

    const cn1Total = finalOrder!.creditNotes[0].totalPaise;
    const cn2Total = finalOrder!.creditNotes[1].totalPaise;
    expect(cn1Total).toBe(100000);
    expect(cn2Total).toBe(129900);
    expect(cn1Total + cn2Total).toBe(229900);
  });

  it("4. Scenario 4: three items (100000, 120000, 80000), shipping 9900, COMPOSITE. Return items 1 and 2 in two returns, NEVER item 3", async () => {
    await prisma.siteSettings.update({
      where: { id: "default" },
      data: { gstFeeMode: "COMPOSITE", businessState: "Punjab" },
    });

    const user = await createTestUser();
    mockCurrentUser = { id: user.id, role: "STAFF" };

    const { product: prod1, variants: var1 } = await createTestProduct({ price: 100000 });
    const { product: prod2, variants: var2 } = await createTestProduct({ price: 120000 });
    const { product: prod3, variants: var3 } = await createTestProduct({ price: 80000 });

    const order = await createTestOrder({
      userId: user.id,
      items: [
        { variantId: var1[0].id, productId: prod1.id, qty: 1, unitPrice: 100000 },
        { variantId: var2[0].id, productId: prod2.id, qty: 1, unitPrice: 120000 },
        { variantId: var3[0].id, productId: prod3.id, qty: 1, unitPrice: 80000 },
      ],
      shippingFee: 9900,
      total: 309900, // 100000 + 120000 + 80000 + 9900
      status: "DELIVERED",
      paymentMethod: "RAZORPAY",
      razorpayPaymentId: "pay_m1test_comp_3items",
      paidAt: new Date(),
      deliveredAt: new Date(),
    });

    await prisma.$transaction(async (tx) => {
      await issueInvoiceForOrder(tx, order.id);
    });

    const invoice = await prisma.invoice.findUnique({
      where: { orderId: order.id },
      include: { lines: true },
    });
    expect(invoice).not.toBeNull();
    expect(invoice!.totalPaise).toBe(309900);
    expect(invoice!.lines.filter((l) => l.kind === "GOODS")).toHaveLength(3);

    const item3Id = order.items[2].id;
    const item3LineId = invoice!.lines.find((l) => l.orderItemId === item3Id)?.id;
    expect(item3LineId).toBeDefined();

    // --- Return 1: Item 1 only ---
    const req1 = await requestReturn({
      orderId: order.id,
      items: [{ orderItemId: order.items[0].id, qty: 1 }],
      reasonCode: "WRONG_SIZE",
    });
    await approveReturn(req1.id);
    const itms1 = await prisma.returnItem.findMany({ where: { returnId: req1.id } });
    await receiveReturn(req1.id, [{ returnItemId: itms1[0].id, restock: true }]);

    mockRefund.mockResolvedValueOnce({ id: "rfnd_comp_3itms_1" });
    await refundReturn(req1.id);

    // Step 1 assertions
    const step1Order = await prisma.order.findUnique({
      where: { id: order.id },
      include: { refunds: true, creditNotes: { include: { lines: true } } },
    });
    const step1RefundsSum = step1Order?.refunds.reduce((s, r) => s + r.amountPaise, 0) || 0;
    const step1CreditNotesSum = step1Order?.creditNotes.reduce((s, cn) => s + cn.totalPaise, 0) || 0;
    expect(step1RefundsSum).toBe(100000);
    expect(step1CreditNotesSum).toBe(100000);
    expect(step1RefundsSum).toBe(step1CreditNotesSum);

    // Verify item 3 is never credited in step 1
    for (const cn of step1Order!.creditNotes) {
      const creditsItem3 = cn.lines.some((l) => l.invoiceLineId === item3LineId);
      expect(creditsItem3).toBe(false);
    }

    // --- Return 2: Item 2 only (item 3 is NEVER returned) ---
    const req2 = await requestReturn({
      orderId: order.id,
      items: [{ orderItemId: order.items[1].id, qty: 1 }],
      reasonCode: "CHANGED_MIND",
    });
    await approveReturn(req2.id);
    const itms2 = await prisma.returnItem.findMany({ where: { returnId: req2.id } });
    await receiveReturn(req2.id, [{ returnItemId: itms2[0].id, restock: true }]);

    mockRefund.mockResolvedValueOnce({ id: "rfnd_comp_3itms_2" });
    await refundReturn(req2.id);

    // Step 2 assertions
    const step2Order = await prisma.order.findUnique({
      where: { id: order.id },
      include: { refunds: true, creditNotes: { include: { lines: true } } },
    });
    const step2RefundsSum = step2Order?.refunds.reduce((s, r) => s + r.amountPaise, 0) || 0;
    const step2CreditNotesSum = step2Order?.creditNotes.reduce((s, cn) => s + cn.totalPaise, 0) || 0;
    expect(step2RefundsSum).toBe(220000); // 100000 + 120000
    expect(step2CreditNotesSum).toBe(220000); // 100000 + 120000 (item amounts only, no fees since item 3 remains)
    expect(step2RefundsSum).toBe(step2CreditNotesSum);

    // Assert: no credit note ever credits item 3's line
    for (const cn of step2Order!.creditNotes) {
      const creditsItem3 = cn.lines.some((l) => l.invoiceLineId === item3LineId);
      expect(creditsItem3).toBe(false);
    }

    // Assert: sum of credit notes < invoice total
    expect(step2CreditNotesSum).toBeLessThan(invoice!.totalPaise);
    expect(step2CreditNotesSum).toBe(220000);
    expect(invoice!.totalPaise).toBe(309900);
  });
});
