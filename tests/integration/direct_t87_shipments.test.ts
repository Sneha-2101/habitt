import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "../helpers/prisma";
import {
  createTestUser,
  createTestProduct,
  createTestOrder,
  cleanupM1TestRows,
} from "../helpers/fixtures";

const mockSendShipmentNotificationEmail = vi.fn().mockResolvedValue({});
const mockSendDeliveredEmail = vi.fn().mockResolvedValue({});
const mockSendReviewRequestEmail = vi.fn().mockResolvedValue({});

let mockStaffUser = { id: "m1test_staff", role: "STAFF" };

vi.mock("@/lib/guards", () => ({
  requireStaff: vi.fn(async () => mockStaffUser),
  requireUser: vi.fn(async () => mockStaffUser),
  requireRole: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/email", () => ({
  sendShipmentNotificationEmail: (orderId: string) => mockSendShipmentNotificationEmail(orderId),
  sendDeliveredEmail: (orderId: string, note?: string) => mockSendDeliveredEmail(orderId, note),
  sendReviewRequestEmail: (orderId: string) => mockSendReviewRequestEmail(orderId),
}));

let mockProviderImpl: {
  name: "SHIPROCKET" | "MANUAL";
  createShipment: (order: unknown) => Promise<unknown>;
  assignAwb: (providerShipmentId: string, providerOrderId?: string) => Promise<unknown>;
  schedulePickup: (providerShipmentId: string) => Promise<unknown>;
  track: (awb: string) => Promise<unknown>;
  cancel: (providerShipmentId: string, awb?: string) => Promise<unknown>;
} | null = null;

vi.mock("@/lib/shipping/shiprocket", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/shipping/shiprocket")>();
  return {
    ...actual,
    getShippingProvider: () => mockProviderImpl || actual.getShippingProvider(),
  };
});

import { markOrderShipped, createShipmentAction } from "@/lib/actions/fulfillment";
import { bulkMarkShipped } from "@/lib/actions/bulk-fulfillment";

describe("T87: Shipments & Providers Integration", () => {
  beforeAll(async () => {
    await cleanupM1TestRows();
    const staff = await createTestUser({ role: "STAFF" });
    mockStaffUser = staff;
  });

  afterAll(async () => {
    await cleanupM1TestRows();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockProviderImpl = null;
  });

  afterEach(() => {
    mockProviderImpl = null;
  });

  it("1. Manual markOrderShipped creates a Shipment row and preserves invoice + email behavior", async () => {
    const user = await createTestUser();
    const { product, variants } = await createTestProduct({ price: 100000 });
    const order = await createTestOrder({
      userId: user.id,
      items: [{ productId: product.id, variantId: variants[0].id, qty: 1, unitPrice: 100000 }],
      status: "PAID",
    });

    await markOrderShipped(order.id, {
      courierName: "Delhivery",
      awbNumber: "DLV123456",
      trackingUrl: "https://track.example.com/DLV123456",
      note: "Dispatched from hub",
    });

    const updatedOrder = await prisma.order.findUnique({
      where: { id: order.id },
      include: {
        shipments: { include: { events: true } },
        invoice: true,
      },
    });

    expect(updatedOrder).not.toBeNull();
    expect(updatedOrder!.fulfilmentStatus).toBe("SHIPPED");
    expect(updatedOrder!.courierName).toBe("Delhivery");
    expect(updatedOrder!.awbNumber).toBe("DLV123456");
    expect(updatedOrder!.shippedAt).not.toBeNull();

    // Shipment row created
    expect(updatedOrder!.shipments).toHaveLength(1);
    const shipment = updatedOrder!.shipments[0];
    expect(shipment.provider).toBe("MANUAL");
    expect(shipment.status).toBe("IN_TRANSIT");
    expect(shipment.courierName).toBe("Delhivery");
    expect(shipment.awb).toBe("DLV123456");

    // Preserves invoice & email
    expect(updatedOrder!.invoice).not.toBeNull();
    expect(mockSendShipmentNotificationEmail).toHaveBeenCalledTimes(1);
  });

  it("2. createShipmentAction with mocked Shiprocket provider creates shipment, assigns AWB, marks order SHIPPED, issues invoice and email", async () => {
    const user = await createTestUser();
    const { product, variants } = await createTestProduct({ price: 150000 });
    const order = await createTestOrder({
      userId: user.id,
      items: [{ productId: product.id, variantId: variants[0].id, qty: 1, unitPrice: 150000 }],
      status: "PAID",
    });

    mockProviderImpl = {
      name: "SHIPROCKET",
      createShipment: vi.fn().mockResolvedValue({
        providerShipmentId: "sr_ship_999",
        providerOrderId: "sr_ord_999",
      }),
      assignAwb: vi.fn().mockResolvedValue({
        awb: "SR_AWB_888",
        courierName: "BlueDart Surface",
      }),
      schedulePickup: vi.fn().mockResolvedValue({ success: true }),
      track: vi.fn(),
      cancel: vi.fn(),
    };

    const res = await createShipmentAction(order.id);
    expect(res.ok).toBe(true);

    const updatedOrder = await prisma.order.findUnique({
      where: { id: order.id },
      include: {
        shipments: { include: { events: true } },
        invoice: true,
      },
    });

    expect(updatedOrder!.fulfilmentStatus).toBe("SHIPPED");
    expect(updatedOrder!.courierName).toBe("BlueDart Surface");
    expect(updatedOrder!.awbNumber).toBe("SR_AWB_888");
    expect(updatedOrder!.invoice).not.toBeNull();
    expect(mockSendShipmentNotificationEmail).toHaveBeenCalledTimes(1);

    expect(updatedOrder!.shipments).toHaveLength(1);
    const shipment = updatedOrder!.shipments[0];
    expect(shipment.provider).toBe("SHIPROCKET");
    expect(["AWB_ASSIGNED", "IN_TRANSIT"]).toContain(shipment.status);
    expect(shipment.awb).toBe("SR_AWB_888");
    expect(shipment.courierName).toBe("BlueDart Surface");
    expect(shipment.events.length).toBeGreaterThanOrEqual(1);
  });

  it("3. Idempotent second call returns existing shipment without re-creating", async () => {
    const user = await createTestUser();
    const { product, variants } = await createTestProduct({ price: 120000 });
    const order = await createTestOrder({
      userId: user.id,
      items: [{ productId: product.id, variantId: variants[0].id, qty: 1, unitPrice: 120000 }],
      status: "PAID",
    });

    const createShipmentMock = vi.fn().mockResolvedValue({
      providerShipmentId: "sr_ship_idem",
      providerOrderId: "sr_ord_idem",
    });

    mockProviderImpl = {
      name: "SHIPROCKET",
      createShipment: createShipmentMock,
      assignAwb: vi.fn().mockResolvedValue({
        awb: "SR_AWB_IDEM",
        courierName: "Delhivery",
      }),
      schedulePickup: vi.fn().mockResolvedValue({ success: true }),
      track: vi.fn(),
      cancel: vi.fn(),
    };

    const firstCall = await createShipmentAction(order.id);
    expect(firstCall.ok).toBe(true);

    const secondCall = await createShipmentAction(order.id);
    expect(secondCall.ok).toBe(true);
    expect(secondCall.shipment?.id).toBe(firstCall.shipment?.id);

    // Should not call createShipment a second time
    expect(createShipmentMock).toHaveBeenCalledTimes(1);

    const shipments = await prisma.shipment.findMany({ where: { orderId: order.id } });
    expect(shipments).toHaveLength(1);
  });

  it("4. Provider failure -> Shipment status FAILED, order not shipped, retry succeeds", async () => {
    const user = await createTestUser();
    const { product, variants } = await createTestProduct({ price: 180000 });
    const order = await createTestOrder({
      userId: user.id,
      items: [{ productId: product.id, variantId: variants[0].id, qty: 1, unitPrice: 180000 }],
      status: "PAID",
    });

    mockProviderImpl = {
      name: "SHIPROCKET",
      createShipment: vi.fn().mockRejectedValue(new Error("Shiprocket API service down")),
      assignAwb: vi.fn(),
      schedulePickup: vi.fn(),
      track: vi.fn(),
      cancel: vi.fn(),
    };

    const failRes = await createShipmentAction(order.id);
    expect(failRes.ok).toBe(false);
    expect(failRes.error).toContain("Shiprocket API service down");

    // Order should NOT be marked shipped
    const orderAfterFail = await prisma.order.findUnique({
      where: { id: order.id },
      include: { shipments: true, invoice: true },
    });
    expect(orderAfterFail!.fulfilmentStatus).toBe("PLACED");
    expect(orderAfterFail!.invoice).toBeNull();
    expect(mockSendShipmentNotificationEmail).not.toHaveBeenCalled();

    // Shipment should be marked FAILED
    expect(orderAfterFail!.shipments).toHaveLength(1);
    expect(orderAfterFail!.shipments[0].status).toBe("FAILED");
    expect(orderAfterFail!.shipments[0].failureReason).toContain("Shiprocket API service down");

    // Now fix provider and retry
    mockProviderImpl = {
      name: "SHIPROCKET",
      createShipment: vi.fn().mockResolvedValue({
        providerShipmentId: "sr_ship_retry",
        providerOrderId: "sr_ord_retry",
      }),
      assignAwb: vi.fn().mockResolvedValue({
        awb: "SR_AWB_RETRY",
        courierName: "Delhivery",
      }),
      schedulePickup: vi.fn().mockResolvedValue({ success: true }),
      track: vi.fn(),
      cancel: vi.fn(),
    };

    const retryRes = await createShipmentAction(order.id);
    expect(retryRes.ok).toBe(true);

    const orderAfterRetry = await prisma.order.findUnique({
      where: { id: order.id },
      include: { shipments: { orderBy: { createdAt: "desc" } }, invoice: true },
    });
    expect(orderAfterRetry!.fulfilmentStatus).toBe("SHIPPED");
    expect(orderAfterRetry!.invoice).not.toBeNull();
    expect(mockSendShipmentNotificationEmail).toHaveBeenCalledTimes(1);

    const activeShipment = orderAfterRetry!.shipments.find((s) => s.status !== "FAILED");
    expect(activeShipment).toBeDefined();
    expect(activeShipment!.awb).toBe("SR_AWB_RETRY");
  });

  it("5. Bulk ship per-row reasons: returns { processed, skipped, errors } with exact details", async () => {
    const user = await createTestUser();
    const { product, variants } = await createTestProduct({ price: 100000 });
    const order1 = await createTestOrder({
      userId: user.id,
      items: [{ productId: product.id, variantId: variants[0].id, qty: 1, unitPrice: 100000 }],
      status: "PAID",
    });
    const order2 = await createTestOrder({
      userId: user.id,
      items: [{ productId: product.id, variantId: variants[0].id, qty: 1, unitPrice: 100000 }],
      status: "CANCELLED",
    });

    const rows = [
      { orderId: order1.id, courierName: "Delhivery", awbNumber: "AWB111" },
      { orderId: order2.id, courierName: "Delhivery", awbNumber: "AWB222" }, // Cancelled order -> error
      { orderId: "m1test_nonexistent", courierName: "Delhivery", awbNumber: "AWB333" }, // Missing order -> error
    ];

    const result = await bulkMarkShipped(rows);
    expect(result.count).toBe(1);
    expect(result.skipped).toHaveLength(2);

    expect(result.skipped[0].orderId).toBe(order2.id);
    expect(result.skipped[0].row).toBe(2);
    expect(result.skipped[0].reason).toMatch(/illegal transition|cancelled/i);

    expect(result.skipped[1].orderId).toBe("m1test_nonexistent");
    expect(result.skipped[1].row).toBe(3);
    expect(result.skipped[1].reason).toMatch(/not found/i);

    // Verify shipment created for valid order
    const ship1 = await prisma.shipment.findFirst({ where: { orderId: order1.id } });
    expect(ship1).not.toBeNull();
    expect(ship1!.awb).toBe("AWB111");
  });
});
