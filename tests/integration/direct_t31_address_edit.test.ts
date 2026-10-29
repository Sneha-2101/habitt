import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma } from "../helpers/prisma";
import {
  createTestUser,
  createTestProduct,
  createTestOrder,
  cleanupM1TestRows,
} from "../helpers/fixtures";

let mockCurrentUser: { id: string; role: string; name?: string; email?: string } = {
  id: "staff_user_1",
  role: "STAFF",
  name: "Support Staff",
  email: "support@test.local",
};

vi.mock("@/lib/guards", () => ({
  requireUser: vi.fn(async () => mockCurrentUser),
  requireStaff: vi.fn(async () => {
    if (mockCurrentUser.role !== "STAFF" && mockCurrentUser.role !== "OWNER") {
      throw new Error("Forbidden: Staff access required");
    }
    return mockCurrentUser;
  }),
  requireRole: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { updateOrderShippingAddress } from "@/lib/actions/order-address";

describe("T31: Staff Address Edit Before Shipping", () => {
  beforeEach(async () => {
    mockCurrentUser = {
      id: "staff_user_1",
      role: "STAFF",
      name: "Support Staff",
      email: "support@test.local",
    };
    vi.clearAllMocks();
    await cleanupM1TestRows();
  });

  afterEach(async () => {
    await cleanupM1TestRows();
  });

  it("allows staff to update shipping address for PENDING orders and logs OrderStatusEvent", async () => {
    const user = await createTestUser();
    const { product, variants } = await createTestProduct({ price: 100000 });
    const order = await createTestOrder({
      userId: user.id,
      items: [{ productId: product.id, variantId: variants[0].id, qty: 1, unitPrice: 100000 }],
      status: "PENDING",
      shippingAddress: {
        line1: "Old Flat 1",
        city: "Old City",
        state: "Old State",
        pincode: "110001",
      },
    });

    const newAddress = {
      line1: "New Suite 400",
      line2: "Tower B",
      city: "New Delhi",
      state: "Delhi",
      pincode: "110002",
      country: "India",
    };

    const result = await updateOrderShippingAddress(order.id, newAddress);
    expect(result.success).toBe(true);
    expect(result.shippingAddress.line1).toBe("New Suite 400");
    expect(result.shippingAddress.pincode).toBe("110002");

    // Verify DB update
    const updated = await prisma.order.findUnique({
      where: { id: order.id },
      include: { statusEvents: true },
    });
    expect((updated?.shippingAddress as Record<string, unknown>)?.line1).toBe("New Suite 400");
    expect((updated?.shippingAddress as Record<string, unknown>)?.pincode).toBe("110002");

    // Verify OrderStatusEvent was recorded
    const event = updated?.statusEvents.find((e) => e.note?.startsWith("Address edited by"));
    expect(event).toBeDefined();
    expect(event?.note).toContain("Support Staff");
    expect(event?.note).toContain("Old Flat 1");
    expect(event?.note).toContain("New Suite 400");
  });

  it("allows staff to update shipping address for PAID orders", async () => {
    const user = await createTestUser();
    const { product, variants } = await createTestProduct({ price: 100000 });
    const order = await createTestOrder({
      userId: user.id,
      items: [{ productId: product.id, variantId: variants[0].id, qty: 1, unitPrice: 100000 }],
      status: "PAID",
      shippingAddress: {
        line1: "Original Street",
        city: "Bangalore",
        state: "Karnataka",
        pincode: "560001",
      },
    });

    const newAddress = {
      line1: "Changed Avenue",
      city: "Bangalore",
      state: "Karnataka",
      pincode: "560002",
    };

    const result = await updateOrderShippingAddress(order.id, newAddress);
    expect(result.success).toBe(true);

    const updated = await prisma.order.findUnique({ where: { id: order.id } });
    expect((updated?.shippingAddress as Record<string, unknown>)?.line1).toBe("Changed Avenue");
  });

  it("rejects address update for SHIPPED, DELIVERED, CANCELLED, and FAILED orders", async () => {
    const user = await createTestUser();
    const { product, variants } = await createTestProduct({ price: 100000 });
    const invalidStatuses = ["SHIPPED", "DELIVERED", "CANCELLED", "FAILED"] as const;

    for (const status of invalidStatuses) {
      const order = await createTestOrder({
        userId: user.id,
        items: [{ productId: product.id, variantId: variants[0].id, qty: 1, unitPrice: 100000 }],
        status,
      });

      await expect(
        updateOrderShippingAddress(order.id, {
          line1: "123 Street",
          city: "City",
          state: "State",
          pincode: "110001",
        })
      ).rejects.toThrow(`Cannot update shipping address for order in status ${status}`);
    }
  });

  it("rejects non-staff user", async () => {
    mockCurrentUser = { id: "customer_1", role: "CUSTOMER" };

    const user = await createTestUser();
    const { product, variants } = await createTestProduct({ price: 100000 });
    const order = await createTestOrder({
      userId: user.id,
      items: [{ productId: product.id, variantId: variants[0].id, qty: 1, unitPrice: 100000 }],
      status: "PENDING",
    });

    await expect(
      updateOrderShippingAddress(order.id, {
        line1: "123 Street",
        city: "City",
        state: "State",
        pincode: "110001",
      })
    ).rejects.toThrow("Forbidden");
  });

  it("rejects invalid address with bad pincode", async () => {
    const user = await createTestUser();
    const { product, variants } = await createTestProduct({ price: 100000 });
    const order = await createTestOrder({
      userId: user.id,
      items: [{ productId: product.id, variantId: variants[0].id, qty: 1, unitPrice: 100000 }],
      status: "PENDING",
    });

    await expect(
      updateOrderShippingAddress(order.id, {
        line1: "123 Street",
        city: "City",
        state: "State",
        pincode: "BAD12", // Not 6 digits
      })
    ).rejects.toThrow();
  });
});

