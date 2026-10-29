import { describe, it, expect, beforeEach, afterEach } from "vitest";
import crypto from "crypto";
import { prisma } from "../helpers/prisma";
import {
  createTestUser,
  createTestProduct,
  cleanupM1TestRows,
} from "../helpers/fixtures";
import { createSessionCookie } from "../helpers/session";
import { Size } from "@prisma/client";

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3000";

describe("T30: Quote Endpoint Safety and Validation", () => {
  beforeEach(async () => {
    await cleanupM1TestRows();
  });

  afterEach(async () => {
    await cleanupM1TestRows();
  });

  it("returns 401 Unauthorized when unauthenticated", async () => {
    const res = await fetch(`${BASE_URL}/api/checkout/quote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: [] }),
    });

    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toBe("Unauthorized");
  });

  it("returns ITEM_UNAVAILABLE warning for archived product and blocks order creation", async () => {
    const user = await createTestUser();
    const session = await createSessionCookie(user.id);
    const { product, variants } = await createTestProduct({
      price: 100000,
      status: "ARCHIVED",
      variants: [{ size: Size.M, stock: 5 }],
    });
    const items = [{ productId: product.id, variantId: variants[0].id, qty: 1 }];

    // Quote call
    const quoteRes = await fetch(`${BASE_URL}/api/checkout/quote`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: session.headerValue },
      body: JSON.stringify({ items }),
    });
    expect(quoteRes.status).toBe(200);
    const quoteData = await quoteRes.json();
    expect(quoteData.warnings.some((w: { type: string }) => w.type === "ITEM_UNAVAILABLE")).toBe(true);

    // Attempt create-order
    const createRes = await fetch(`${BASE_URL}/api/checkout/create-order`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: session.headerValue },
      body: JSON.stringify({
        idempotencyKey: crypto.randomUUID(),
        items,
        paymentMethod: "RAZORPAY",
        customerName: "T30 User",
        customerPhone: "9876543210",
        shippingAddress: { line1: "123 Street", city: "City", state: "State", pincode: "110001" },
      }),
    });
    expect(createRes.status).toBe(409);

    // Verify no order created
    const orderCount = await prisma.order.count({ where: { userId: user.id } });
    expect(orderCount).toBe(0);
  });

  it("rejects bad quantity (>10) and blocks order creation", async () => {
    const user = await createTestUser();
    const session = await createSessionCookie(user.id);
    const { product, variants } = await createTestProduct({
      price: 100000,
      variants: [{ size: Size.M, stock: 20 }],
    });

    // 1. Direct single item with qty: 11 rejected by quote validation (400)
    const quoteDirectRes = await fetch(`${BASE_URL}/api/checkout/quote`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: session.headerValue },
      body: JSON.stringify({ items: [{ productId: product.id, variantId: variants[0].id, qty: 11 }] }),
    });
    expect(quoteDirectRes.status).toBe(400);

    // 2. Merged duplicate items summing to 12 flagged by quote engine warning
    const mergedItems = [
      { productId: product.id, variantId: variants[0].id, qty: 6 },
      { productId: product.id, variantId: variants[0].id, qty: 6 },
    ];
    const quoteMergedRes = await fetch(`${BASE_URL}/api/checkout/quote`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: session.headerValue },
      body: JSON.stringify({ items: mergedItems }),
    });
    expect(quoteMergedRes.status).toBe(200);
    const quoteMergedData = await quoteMergedRes.json();
    expect(quoteMergedData.warnings.some((w: { type: string }) => w.type === "MAX_QTY_EXCEEDED")).toBe(true);

    // 3. Create-order call with bad quantity (>10) rejected (400)
    const createRes = await fetch(`${BASE_URL}/api/checkout/create-order`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: session.headerValue },
      body: JSON.stringify({
        idempotencyKey: crypto.randomUUID(),
        items: [{ productId: product.id, variantId: variants[0].id, qty: 11 }],
        paymentMethod: "RAZORPAY",
        customerName: "T30 User",
        customerPhone: "9876543210",
        shippingAddress: { line1: "123 Street", city: "City", state: "State", pincode: "110001" },
      }),
    });
    expect(createRes.status).toBe(400);
    const createData = await createRes.json();
    expect(createData.error).toContain("Maximum quantity");

    // 4. Create-order with merged duplicate items totaling > 10 also rejected (400)
    const createMergedRes = await fetch(`${BASE_URL}/api/checkout/create-order`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: session.headerValue },
      body: JSON.stringify({
        idempotencyKey: crypto.randomUUID(),
        items: mergedItems,
        paymentMethod: "RAZORPAY",
        customerName: "T30 User",
        customerPhone: "9876543210",
        shippingAddress: { line1: "123 Street", city: "City", state: "State", pincode: "110001" },
      }),
    });
    expect(createMergedRes.status).toBe(400);
    const createMergedData = await createMergedRes.json();
    expect(createMergedData.error).toContain("Maximum quantity per item is 10");
  });
});
