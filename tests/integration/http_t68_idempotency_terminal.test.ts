import { describe, it, expect, beforeEach, afterEach } from "vitest";
import crypto from "crypto";
import { prisma } from "../helpers/prisma";
import {
  createTestUser,
  createTestProduct,
  createTestOrder,
  cleanupM1TestRows,
} from "../helpers/fixtures";
import { createSessionCookie } from "../helpers/session";

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3000";

describe("T68: Create Order Idempotency Terminal States", () => {
  beforeEach(async () => {
    await cleanupM1TestRows();
  });

  afterEach(async () => {
    await cleanupM1TestRows();
  });

  it("returns 409 retry: true for all terminal order states and handles positive controls", async () => {
    const user = await createTestUser();
    const session = await createSessionCookie(user.id);
    const { product, variants } = await createTestProduct({
      price: 100000,
      variants: [{ size: "M", stock: 50 }],
    });
    const variant = variants[0];

    const basePayload = {
      items: [{ productId: product.id, variantId: variant.id, qty: 1 }],
      customerName: "Terminal Tester",
      customerPhone: "9876543210",
      shippingAddress: {
        line1: "123 Marine Drive",
        city: "Mumbai",
        state: "Maharashtra",
        pincode: "400001",
      },
      paymentMethod: "RAZORPAY" as const,
      useStoreCredit: false,
    };

    // Case (a): PENDING + CANCELLED (RAZORPAY, with razorpayOrderId)
    const keyA = crypto.randomUUID();
    const orderA = await createTestOrder({
      userId: user.id,
      items: [{ productId: product.id, variantId: variant.id, qty: 1, unitPrice: 100000 }],
      paymentStatus: "PENDING",
      fulfilmentStatus: "CANCELLED",
      paymentMethod: "RAZORPAY",
      razorpayOrderId: `order_m1test_rzp_${crypto.randomBytes(4).toString("hex")}`,
    });
    await prisma.order.update({
      where: { id: orderA.id },
      data: { idempotencyKey: keyA },
    });

    const resA = await fetch(`${BASE_URL}/api/checkout/create-order`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: session.headerValue },
      body: JSON.stringify({ ...basePayload, idempotencyKey: keyA }),
    });
    expect(resA.status).toBe(409);
    const bodyA = await resA.json();
    expect(bodyA.retry).toBe(true);
    expect(bodyA.error).toBe("This checkout expired");
    expect(bodyA.alreadyPaid).toBeUndefined();
    expect(bodyA.razorpayOrderId).toBeUndefined();

    // Case (b): COD_PENDING + CANCELLED (COD)
    const keyB = crypto.randomUUID();
    const orderB = await createTestOrder({
      userId: user.id,
      items: [{ productId: product.id, variantId: variant.id, qty: 1, unitPrice: 100000 }],
      paymentStatus: "COD_PENDING",
      fulfilmentStatus: "CANCELLED",
      paymentMethod: "COD",
    });
    await prisma.order.update({
      where: { id: orderB.id },
      data: { idempotencyKey: keyB },
    });

    const resB = await fetch(`${BASE_URL}/api/checkout/create-order`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: session.headerValue },
      body: JSON.stringify({ ...basePayload, paymentMethod: "COD", idempotencyKey: keyB }),
    });
    expect(resB.status).toBe(409);
    const bodyB = await resB.json();
    expect(bodyB.retry).toBe(true);
    expect(bodyB.error).toBe("This checkout expired");
    expect(bodyB.alreadyPaid).toBeUndefined();
    expect(bodyB.razorpayOrderId).toBeUndefined();

    // Case (c): PAID + CANCELLED (RAZORPAY, refund failed case)
    const keyC = crypto.randomUUID();
    const orderC = await createTestOrder({
      userId: user.id,
      items: [{ productId: product.id, variantId: variant.id, qty: 1, unitPrice: 100000 }],
      paymentStatus: "PAID",
      fulfilmentStatus: "CANCELLED",
      paymentMethod: "RAZORPAY",
      paidAt: new Date(),
    });
    await prisma.order.update({
      where: { id: orderC.id },
      data: { idempotencyKey: keyC },
    });

    const resC = await fetch(`${BASE_URL}/api/checkout/create-order`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: session.headerValue },
      body: JSON.stringify({ ...basePayload, idempotencyKey: keyC }),
    });
    expect(resC.status).toBe(409);
    const bodyC = await resC.json();
    expect(bodyC.retry).toBe(true);
    expect(bodyC.error).toBe("This checkout expired");
    expect(bodyC.alreadyPaid).toBeUndefined();
    expect(bodyC.razorpayOrderId).toBeUndefined();

    // Case (d): FAILED + CREATED
    const keyD = crypto.randomUUID();
    const orderD = await createTestOrder({
      userId: user.id,
      items: [{ productId: product.id, variantId: variant.id, qty: 1, unitPrice: 100000 }],
      paymentStatus: "FAILED",
      fulfilmentStatus: "CREATED",
      paymentMethod: "RAZORPAY",
    });
    await prisma.order.update({
      where: { id: orderD.id },
      data: { idempotencyKey: keyD },
    });

    const resD = await fetch(`${BASE_URL}/api/checkout/create-order`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: session.headerValue },
      body: JSON.stringify({ ...basePayload, idempotencyKey: keyD }),
    });
    expect(resD.status).toBe(409);
    const bodyD = await resD.json();
    expect(bodyD.retry).toBe(true);
    expect(bodyD.error).toBe("This checkout expired");
    expect(bodyD.alreadyPaid).toBeUndefined();
    expect(bodyD.razorpayOrderId).toBeUndefined();

    // Positive Control 1: PENDING + CREATED still returns the existing Razorpay order
    const keyPos1 = crypto.randomUUID();
    const rzpOrderIdPos1 = `order_m1test_pos1_${crypto.randomBytes(4).toString("hex")}`;
    const orderPos1 = await createTestOrder({
      userId: user.id,
      items: [{ productId: product.id, variantId: variant.id, qty: 1, unitPrice: 100000 }],
      paymentStatus: "PENDING",
      fulfilmentStatus: "CREATED",
      paymentMethod: "RAZORPAY",
      razorpayOrderId: rzpOrderIdPos1,
    });
    await prisma.order.update({
      where: { id: orderPos1.id },
      data: { idempotencyKey: keyPos1 },
    });

    const resPos1 = await fetch(`${BASE_URL}/api/checkout/create-order`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: session.headerValue },
      body: JSON.stringify({ ...basePayload, idempotencyKey: keyPos1 }),
    });
    expect(resPos1.status).toBe(200);
    const bodyPos1 = await resPos1.json();
    expect(bodyPos1.orderId).toBe(orderPos1.id);
    expect(bodyPos1.razorpayOrderId).toBe(rzpOrderIdPos1);

    // Positive Control 2: PAID + PLACED still returns alreadyPaid
    const keyPos2 = crypto.randomUUID();
    const orderPos2 = await createTestOrder({
      userId: user.id,
      items: [{ productId: product.id, variantId: variant.id, qty: 1, unitPrice: 100000 }],
      paymentStatus: "PAID",
      fulfilmentStatus: "PLACED",
      paymentMethod: "RAZORPAY",
      paidAt: new Date(),
    });
    await prisma.order.update({
      where: { id: orderPos2.id },
      data: { idempotencyKey: keyPos2 },
    });

    const resPos2 = await fetch(`${BASE_URL}/api/checkout/create-order`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: session.headerValue },
      body: JSON.stringify({ ...basePayload, idempotencyKey: keyPos2 }),
    });
    expect(resPos2.status).toBe(200);
    const bodyPos2 = await resPos2.json();
    expect(bodyPos2.alreadyPaid).toBe(true);
    expect(bodyPos2.orderId).toBe(orderPos2.id);
  });
});
