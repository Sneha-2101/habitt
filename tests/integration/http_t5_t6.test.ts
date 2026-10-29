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
import { verifySignature } from "../helpers/razorpay";

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3000";

describe("T5 & T6: Oversell Clamp & Late Capture After Cancel", () => {
  beforeEach(async () => {
    await cleanupM1TestRows();
  });

  afterEach(async () => {
    await cleanupM1TestRows();
  });

  it("T5 oversell after capture: variant stock 1, two payers both PAID, stock 0, one OVERSOLD movement", async () => {
    const user1 = await createTestUser();
    const session1 = await createSessionCookie(user1.id);

    const user2 = await createTestUser();
    const session2 = await createSessionCookie(user2.id);

    // Variant stock = 1
    const { product, variants } = await createTestProduct({ price: 100000, variants: [{ size: "M", stock: 1 }] });
    const variant = variants[0];

    // Customer 1 creates PENDING order for qty 1
    const res1 = await fetch(`${BASE_URL}/api/checkout/create-order`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: session1.headerValue },
      body: JSON.stringify({
        idempotencyKey: crypto.randomUUID(),
        items: [{ productId: product.id, variantId: variant.id, qty: 1 }],
        customerName: "Customer One",
        customerPhone: "9876543210",
        shippingAddress: { line1: "Street 1", city: "Mumbai", state: "MH", pincode: "400001" },
        paymentMethod: "RAZORPAY",
        useStoreCredit: false,
      }),
    });
    expect(res1.status).toBe(200);
    const data1 = await res1.json();

    // Customer 2 creates PENDING order for qty 1 (stock is not reserved until payment for Razorpay)
    const res2 = await fetch(`${BASE_URL}/api/checkout/create-order`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: session2.headerValue },
      body: JSON.stringify({
        idempotencyKey: crypto.randomUUID(),
        items: [{ productId: product.id, variantId: variant.id, qty: 1 }],
        customerName: "Customer Two",
        customerPhone: "9876543211",
        shippingAddress: { line1: "Street 2", city: "Mumbai", state: "MH", pincode: "400001" },
        paymentMethod: "RAZORPAY",
        useStoreCredit: false,
      }),
    });
    expect(res2.status).toBe(200);
    const data2 = await res2.json();

    // Both pay via fabricated verify
    const payId1 = `pay_m1test_${crypto.randomBytes(6).toString("hex")}`;
    const sig1 = verifySignature(data1.razorpayOrderId, payId1);

    const payId2 = `pay_m1test_${crypto.randomBytes(6).toString("hex")}`;
    const sig2 = verifySignature(data2.razorpayOrderId, payId2);

    const verify1 = await fetch(`${BASE_URL}/api/checkout/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: session1.headerValue },
      body: JSON.stringify({
        razorpay_order_id: data1.razorpayOrderId,
        razorpay_payment_id: payId1,
        razorpay_signature: sig1,
      }),
    });
    expect(verify1.status).toBe(200);

    const verify2 = await fetch(`${BASE_URL}/api/checkout/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: session2.headerValue },
      body: JSON.stringify({
        razorpay_order_id: data2.razorpayOrderId,
        razorpay_payment_id: payId2,
        razorpay_signature: sig2,
      }),
    });
    expect(verify2.status).toBe(200);

    // Both orders must be PAID
    const order1 = await prisma.order.findUnique({ where: { id: data1.orderId } });
    const order2 = await prisma.order.findUnique({ where: { id: data2.orderId } });
    expect(order1?.status).toBe("PAID");
    expect(order2?.status).toBe("PAID");

    // Stock must be 0, never negative
    const finalVariant = await prisma.productVariant.findUnique({ where: { id: variant.id } });
    expect(finalVariant?.stock).toBe(0);

    // Exactly one SALE movement and exactly one OVERSOLD movement
    const movements = await prisma.stockMovement.findMany({
      where: { variantId: variant.id },
      orderBy: { createdAt: "asc" },
    });
    expect(movements).toHaveLength(2);
    expect(movements.some((m) => m.reason === "SALE" && m.delta === -1)).toBe(true);
    expect(movements.some((m) => m.reason === "OVERSOLD" && m.delta === -1)).toBe(true);
  });

  it("T6 late capture after cancel: order stays CANCELLED, note events logged, refund fails on real API, stock unchanged", async () => {
    const user = await createTestUser();
    const session = await createSessionCookie(user.id);
    const { product, variants } = await createTestProduct({ price: 100000, variants: [{ size: "M", stock: 5 }] });
    const variant = variants[0];
    const rzpOrderId = `order_m1test_${crypto.randomBytes(6).toString("hex")}`;

    // Create a PENDING order
    const order = await createTestOrder({
      userId: user.id,
      items: [{ variantId: variant.id, productId: product.id, qty: 1, unitPrice: 100000 }],
      status: "PENDING",
      paymentMethod: "RAZORPAY",
      stockDeducted: false,
      razorpayOrderId: rzpOrderId,
    });

    // Cancel the order
    await prisma.order.update({
      where: { id: order.id },
      data: { status: "CANCELLED", cancellationReason: "Customer changed mind" },
    });

    // Call verify with fabricated payment id
    const fabricatedPaymentId = `pay_m1test_${crypto.randomBytes(6).toString("hex")}`;
    const sig = verifySignature(rzpOrderId, fabricatedPaymentId);

    const verifyRes = await fetch(`${BASE_URL}/api/checkout/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: session.headerValue },
      body: JSON.stringify({
        razorpay_order_id: rzpOrderId,
        razorpay_payment_id: fabricatedPaymentId,
        razorpay_signature: sig,
      }),
    });
    expect(verifyRes.status).toBe(200);

    // Order must stay CANCELLED
    const checkedOrder = await prisma.order.findUnique({ where: { id: order.id } });
    expect(checkedOrder?.status).toBe("CANCELLED");

    // Stock unchanged (still 5)
    const checkedVariant = await prisma.productVariant.findUnique({ where: { id: variant.id } });
    expect(checkedVariant?.stock).toBe(5);

    // Wait a brief moment for the asynchronous refund attempt to complete
    await new Promise((r) => setTimeout(r, 1200));

    // Check OrderStatusEvents
    const events = await prisma.orderStatusEvent.findMany({
      where: { orderId: order.id },
    });

    // First event: "Payment captured after cancellation"
    expect(
      events.some((e) => e.note?.includes("Payment captured after cancellation"))
    ).toBe(true);

    // Second event: refund attempt failed against real Razorpay API (fabricated payment ID doesn't exist)
    expect(
      events.some((e) => e.note?.includes("REFUND FAILED"))
    ).toBe(true);
  });
});
