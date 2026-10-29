import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma } from "../helpers/prisma";
import {
  createTestUser,
  createTestProduct,
  createTestOrder,
  cleanupM1TestRows,
} from "../helpers/fixtures";

// Setup mocks
let mockCurrentUser: { id: string; role: string } = { id: "default_staff", role: "STAFF" };

vi.mock("@/lib/guards", () => ({
  requireUser: vi.fn(async () => mockCurrentUser),
  requireStaff: vi.fn(async () => mockCurrentUser),
  requireRole: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/email", () => ({
  sendShipmentNotificationEmail: vi.fn().mockResolvedValue({}),
  sendDeliveredEmail: vi.fn().mockResolvedValue({}),
  sendReviewRequestEmail: vi.fn().mockResolvedValue({}),
}));

import { markOrderShipped, markOrderDelivered } from "@/lib/actions/fulfillment";
import { bulkMarkShipped } from "@/lib/actions/bulk-fulfillment";

describe("T16: Order Fulfillment Integrity", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await cleanupM1TestRows();
  });

  afterEach(async () => {
    await cleanupM1TestRows();
  });

  it("T16 fulfilment: markOrderShipped throws on PENDING Razorpay, CANCELLED, FAILED; succeeds on PAID", async () => {
    const user = await createTestUser();
    mockCurrentUser = { id: user.id, role: "STAFF" };

    const { product, variants } = await createTestProduct({ price: 100000, variants: [{ size: "M", stock: 10 }] });
    const variant = variants[0];

    const courierData = {
      courierName: "BlueDart",
      awbNumber: "BD123456789",
    };

    // 1. PENDING Razorpay order -> throws
    const pendingRazorpay = await createTestOrder({
      userId: user.id,
      items: [{ variantId: variant.id, productId: product.id, qty: 1, unitPrice: 100000 }],
      status: "PENDING",
      paymentMethod: "RAZORPAY",
    });
    await expect(markOrderShipped(pendingRazorpay.id, courierData)).rejects.toThrow(
      "Order cannot be marked shipped from status PENDING"
    );

    // 2. CANCELLED order -> throws
    const cancelledOrder = await createTestOrder({
      userId: user.id,
      items: [{ variantId: variant.id, productId: product.id, qty: 1, unitPrice: 100000 }],
      status: "CANCELLED",
      paymentMethod: "RAZORPAY",
    });
    await expect(markOrderShipped(cancelledOrder.id, courierData)).rejects.toThrow(
      "Order cannot be marked shipped from status CANCELLED"
    );

    // 3. FAILED order -> throws
    const failedOrder = await createTestOrder({
      userId: user.id,
      items: [{ variantId: variant.id, productId: product.id, qty: 1, unitPrice: 100000 }],
      status: "FAILED",
      paymentMethod: "RAZORPAY",
    });
    await expect(markOrderShipped(failedOrder.id, courierData)).rejects.toThrow(
      "Order cannot be marked shipped from status FAILED"
    );

    // 4. PAID order -> succeeds
    const paidOrder = await createTestOrder({
      userId: user.id,
      items: [{ variantId: variant.id, productId: product.id, qty: 1, unitPrice: 100000 }],
      status: "PAID",
      paymentMethod: "RAZORPAY",
      stockDeducted: true,
    });
    await markOrderShipped(paidOrder.id, courierData);

    const shipped = await prisma.order.findUnique({ where: { id: paidOrder.id } });
    expect(shipped?.status).toBe("SHIPPED");
    expect(shipped?.courierName).toBe("BlueDart");
    expect(shipped?.awbNumber).toBe("BD123456789");
    expect(shipped?.shippedAt).not.toBeNull();
  });

  it("T16 fulfilment: markOrderDelivered only from SHIPPED, sets paidAt on COD", async () => {
    const user = await createTestUser();
    mockCurrentUser = { id: user.id, role: "STAFF" };

    const { product, variants } = await createTestProduct({ price: 100000, variants: [{ size: "M", stock: 10 }] });
    const variant = variants[0];

    // 1. From PAID -> throws (must be SHIPPED first)
    const paidOrder = await createTestOrder({
      userId: user.id,
      items: [{ variantId: variant.id, productId: product.id, qty: 1, unitPrice: 100000 }],
      status: "PAID",
      paymentMethod: "RAZORPAY",
      stockDeducted: true,
    });
    await expect(markOrderDelivered(paidOrder.id)).rejects.toThrow(
      "Order cannot be marked delivered from status PAID"
    );

    // 2. From SHIPPED (COD order) -> succeeds and sets deliveredAt + paidAt
    const shippedCod = await createTestOrder({
      userId: user.id,
      items: [{ variantId: variant.id, productId: product.id, qty: 1, unitPrice: 100000 }],
      status: "SHIPPED",
      paymentMethod: "COD",
      stockDeducted: true,
    });
    await markOrderDelivered(shippedCod.id, "Delivered and cash collected");

    const deliveredCod = await prisma.order.findUnique({ where: { id: shippedCod.id } });
    expect(deliveredCod?.status).toBe("DELIVERED");
    expect(deliveredCod?.deliveredAt).not.toBeNull();
    expect(deliveredCod?.paidAt).not.toBeNull();
  });

  it("T16 bulkMarkShipped: on mixed set, ships only legal rows and reports skipped ones", async () => {
    const user = await createTestUser();
    mockCurrentUser = { id: user.id, role: "STAFF" };

    const { product, variants } = await createTestProduct({ price: 100000, variants: [{ size: "M", stock: 10 }] });
    const variant = variants[0];

    // Legal 1: PAID Razorpay
    const legalPaid = await createTestOrder({
      userId: user.id,
      items: [{ variantId: variant.id, productId: product.id, qty: 1, unitPrice: 100000 }],
      status: "PAID",
      paymentMethod: "RAZORPAY",
      stockDeducted: true,
    });

    // Legal 2: PENDING COD
    const legalCod = await createTestOrder({
      userId: user.id,
      items: [{ variantId: variant.id, productId: product.id, qty: 1, unitPrice: 100000 }],
      status: "PENDING",
      paymentMethod: "COD",
      stockDeducted: true,
    });

    // Illegal 1: PENDING Razorpay
    const illegalPending = await createTestOrder({
      userId: user.id,
      items: [{ variantId: variant.id, productId: product.id, qty: 1, unitPrice: 100000 }],
      status: "PENDING",
      paymentMethod: "RAZORPAY",
    });

    // Illegal 2: CANCELLED order
    const illegalCancelled = await createTestOrder({
      userId: user.id,
      items: [{ variantId: variant.id, productId: product.id, qty: 1, unitPrice: 100000 }],
      status: "CANCELLED",
      paymentMethod: "COD",
    });

    const shipments = [
      { orderId: legalPaid.id, courierName: "Delhivery", awbNumber: "DL001" },
      { orderId: legalCod.id, courierName: "Delhivery", awbNumber: "DL002" },
      { orderId: illegalPending.id, courierName: "Delhivery", awbNumber: "DL003" },
      { orderId: illegalCancelled.id, courierName: "Delhivery", awbNumber: "DL004" },
    ];

    const result = await bulkMarkShipped(shipments);

    expect(result.count).toBe(2);
    expect(result.skipped).toHaveLength(2);
    expect(result.skipped.map((s) => s.orderId)).toContain(illegalPending.id);
    expect(result.skipped.map((s) => s.orderId)).toContain(illegalCancelled.id);

    // Verify legal rows became SHIPPED in DB
    const checkedPaid = await prisma.order.findUnique({ where: { id: legalPaid.id } });
    expect(checkedPaid?.status).toBe("SHIPPED");

    const checkedCod = await prisma.order.findUnique({ where: { id: legalCod.id } });
    expect(checkedCod?.status).toBe("SHIPPED");

    // Verify illegal rows remained unchanged
    const checkedPending = await prisma.order.findUnique({ where: { id: illegalPending.id } });
    expect(checkedPending?.status).toBe("PENDING");

    const checkedCancelled = await prisma.order.findUnique({ where: { id: illegalCancelled.id } });
    expect(checkedCancelled?.status).toBe("CANCELLED");
  });
});
