import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "../helpers/prisma";
import {
  createTestUser,
  createTestProduct,
  createTestOrder,
  cleanupM1TestRows,
} from "../helpers/fixtures";
import { buildOrderWhere, buildStatusFilter } from "@/lib/orders/status-filter";
import { legacyStage } from "@/lib/orders/status-label";
import { PaymentMethod, PaymentStatus, FulfilmentStatus } from "@prisma/client";

describe("T69: Order Status Filter & Where Builder", () => {
  beforeEach(async () => {
    await cleanupM1TestRows();
  });

  afterEach(async () => {
    await cleanupM1TestRows();
  });

  it("filters orders across all backfill combinations and respects search queries", async () => {
    const user = await createTestUser();
    const { product, variants } = await createTestProduct({
      price: 100000,
      variants: [{ size: "M", stock: 100 }],
    });
    const variant = variants[0];

    const combos: Array<{
      key: string;
      customerName: string;
      customerEmail: string;
      paymentMethod: PaymentMethod;
      paymentStatus: PaymentStatus;
      fulfilmentStatus: FulfilmentStatus;
      paidAt?: Date;
    }> = [
      // RAZORPAY combinations
      { key: "rzp_pending", customerName: "Alice Pending", customerEmail: "m1test_alice@test.test", paymentMethod: "RAZORPAY", paymentStatus: "PENDING", fulfilmentStatus: "CREATED" },
      { key: "rzp_paid", customerName: "Bob Paid", customerEmail: "m1test_bob@test.test", paymentMethod: "RAZORPAY", paymentStatus: "PAID", fulfilmentStatus: "PLACED", paidAt: new Date() },
      { key: "rzp_shipped", customerName: "Charlie Shipped", customerEmail: "m1test_charlie@test.test", paymentMethod: "RAZORPAY", paymentStatus: "PAID", fulfilmentStatus: "SHIPPED", paidAt: new Date() },
      { key: "rzp_delivered", customerName: "David Delivered", customerEmail: "m1test_david@test.test", paymentMethod: "RAZORPAY", paymentStatus: "PAID", fulfilmentStatus: "DELIVERED", paidAt: new Date() },
      { key: "rzp_failed", customerName: "Eve Failed", customerEmail: "m1test_eve@test.test", paymentMethod: "RAZORPAY", paymentStatus: "FAILED", fulfilmentStatus: "CREATED" },
      { key: "rzp_pend_canc", customerName: "Frank Cancelled", customerEmail: "m1test_frank@test.test", paymentMethod: "RAZORPAY", paymentStatus: "PENDING", fulfilmentStatus: "CANCELLED" },
      { key: "rzp_paid_canc", customerName: "Grace Cancelled", customerEmail: "m1test_grace@test.test", paymentMethod: "RAZORPAY", paymentStatus: "PAID", fulfilmentStatus: "CANCELLED", paidAt: new Date() },
      { key: "rzp_ref_canc", customerName: "Heidi Refunded", customerEmail: "m1test_heidi@test.test", paymentMethod: "RAZORPAY", paymentStatus: "REFUNDED", fulfilmentStatus: "CANCELLED", paidAt: new Date() },
      // COD combinations
      { key: "cod_placed", customerName: "Ivan COD Placed", customerEmail: "m1test_ivan@test.test", paymentMethod: "COD", paymentStatus: "COD_PENDING", fulfilmentStatus: "PLACED" },
      { key: "cod_shipped", customerName: "Judy COD Shipped", customerEmail: "m1test_judy@test.test", paymentMethod: "COD", paymentStatus: "COD_PENDING", fulfilmentStatus: "SHIPPED" },
      { key: "cod_delivered", customerName: "Kevin COD Delivered", customerEmail: "m1test_kevin@test.test", paymentMethod: "COD", paymentStatus: "COD_COLLECTED", fulfilmentStatus: "DELIVERED", paidAt: new Date() },
      { key: "cod_canc", customerName: "Laura COD Cancelled", customerEmail: "m1test_laura@test.test", paymentMethod: "COD", paymentStatus: "COD_PENDING", fulfilmentStatus: "CANCELLED" },
      // STORE_CREDIT combination
      { key: "sc_paid", customerName: "Mallory Credit Paid", customerEmail: "m1test_mallory@test.test", paymentMethod: "STORE_CREDIT", paymentStatus: "PAID", fulfilmentStatus: "PLACED", paidAt: new Date() },
    ];

    const orderMap = new Map<string, Awaited<ReturnType<typeof createTestOrder>>>();
    for (const c of combos) {
      const order = await createTestOrder({
        userId: user.id,
        customerName: c.customerName,
        items: [{ productId: product.id, variantId: variant.id, qty: 1, unitPrice: 100000 }],
        paymentMethod: c.paymentMethod,
        paymentStatus: c.paymentStatus,
        fulfilmentStatus: c.fulfilmentStatus,
        paidAt: c.paidAt,
      });
      orderMap.set(c.key, order);
    }

    // 1. Verify tabs return EXACTLY the expected set of ids and match legacyStage
    const tabs: Array<"PENDING" | "PAID" | "SHIPPED" | "DELIVERED" | "CANCELLED" | "FAILED"> = [
      "PENDING",
      "PAID",
      "SHIPPED",
      "DELIVERED",
      "CANCELLED",
      "FAILED",
    ];

    for (const tab of tabs) {
      const results = await prisma.order.findMany({
        where: {
          id: { in: Array.from(orderMap.values()).map((o) => o.id) },
          ...buildOrderWhere({ status: tab }),
        },
      });

      const actualIds = new Set(results.map((r) => r.id));

      // Calculate expected ids from legacyStage
      const expectedIds = new Set(
        Array.from(orderMap.values())
          .filter((o) => legacyStage(o) === tab)
          .map((o) => o.id)
      );

      expect(actualIds).toEqual(expectedIds);
    }

    // Specifically verify expected members of PENDING:
    // rzp_pending (RAZORPAY, PENDING, CREATED) & cod_placed (COD, COD_PENDING, PLACED)
    const pendingOrders = await prisma.order.findMany({
      where: {
        id: { in: Array.from(orderMap.values()).map((o) => o.id) },
        ...buildOrderWhere({ status: "PENDING" }),
      },
    });
    const pendingIds = new Set(pendingOrders.map((o) => o.id));
    expect(pendingIds).toEqual(new Set([orderMap.get("rzp_pending")!.id, orderMap.get("cod_placed")!.id]));

    // Specifically verify expected members of PAID:
    // rzp_paid (RAZORPAY, PAID, PLACED) & sc_paid (STORE_CREDIT, PAID, PLACED)
    const paidOrders = await prisma.order.findMany({
      where: {
        id: { in: Array.from(orderMap.values()).map((o) => o.id) },
        ...buildOrderWhere({ status: "PAID" }),
      },
    });
    const paidIds = new Set(paidOrders.map((o) => o.id));
    expect(paidIds).toEqual(new Set([orderMap.get("rzp_paid")!.id, orderMap.get("sc_paid")!.id]));

    // 2. status + q together (the old bug where q overwritten status OR):
    // Searching for "Ivan" in PENDING -> matches cod_placed
    const searchInPending = await prisma.order.findMany({
      where: {
        id: { in: Array.from(orderMap.values()).map((o) => o.id) },
        ...buildOrderWhere({ status: "PENDING", q: "Ivan" }),
      },
    });
    expect(searchInPending).toHaveLength(1);
    expect(searchInPending[0]?.id).toBe(orderMap.get("cod_placed")!.id);

    // Searching for "Bob" in PENDING -> matches nothing (Bob is in PAID)
    const searchBobInPending = await prisma.order.findMany({
      where: {
        id: { in: Array.from(orderMap.values()).map((o) => o.id) },
        ...buildOrderWhere({ status: "PENDING", q: "Bob" }),
      },
    });
    expect(searchBobInPending).toHaveLength(0);

    // 3. status + paymentMethod:
    // PENDING + COD -> only cod_placed
    const codInPending = await prisma.order.findMany({
      where: {
        id: { in: Array.from(orderMap.values()).map((o) => o.id) },
        ...buildOrderWhere({ status: "PENDING", paymentMethod: "COD" }),
      },
    });
    expect(codInPending).toHaveLength(1);
    expect(codInPending[0]?.id).toBe(orderMap.get("cod_placed")!.id);

    // PENDING + RAZORPAY -> only rzp_pending
    const rzpInPending = await prisma.order.findMany({
      where: {
        id: { in: Array.from(orderMap.values()).map((o) => o.id) },
        ...buildOrderWhere({ status: "PENDING", paymentMethod: "RAZORPAY" }),
      },
    });
    expect(rzpInPending).toHaveLength(1);
    expect(rzpInPending[0]?.id).toBe(orderMap.get("rzp_pending")!.id);

    // 4. Unknown status returns everything, never throws for "BANANA"
    expect(() => buildStatusFilter("BANANA")).not.toThrow();
    expect(buildStatusFilter("BANANA")).toEqual({});

    const bananaOrders = await prisma.order.findMany({
      where: {
        id: { in: Array.from(orderMap.values()).map((o) => o.id) },
        ...buildOrderWhere({ status: "BANANA" }),
      },
    });
    expect(bananaOrders).toHaveLength(combos.length);

    // Empty status returns everything
    const allOrders = await prisma.order.findMany({
      where: {
        id: { in: Array.from(orderMap.values()).map((o) => o.id) },
        ...buildOrderWhere({ status: "" }),
      },
    });
    expect(allOrders).toHaveLength(combos.length);
  });
});
