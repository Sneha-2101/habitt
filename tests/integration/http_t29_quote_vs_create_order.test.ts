import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import crypto from "crypto";
import { prisma } from "../helpers/prisma";
import {
  createTestUser,
  createTestProduct,
  createTestCoupon,
  cleanupM1TestRows,
} from "../helpers/fixtures";
import { createSessionCookie } from "../helpers/session";
import { SiteSettings, Size } from "@prisma/client";

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3000";

describe("T29: Quote Equals Create-Order Across 6 Scenarios", () => {
  let originalSettings: SiteSettings | null = null;

  beforeAll(async () => {
    originalSettings = await prisma.siteSettings.findFirst();
    if (originalSettings) {
      await prisma.siteSettings.update({
        where: { id: originalSettings.id },
        data: {
          codEnabled: true,
          codOrderCap: 500000,
          codRequiresDeliveredOrder: false,
          freeShippingOnPrepaid: true,
          shippingFee: 9900,
          freeShippingThreshold: 299900,
          codFeeEnabled: true,
          codFee: 5000,
        },
      });
    }
  });

  afterAll(async () => {
    if (originalSettings) {
      const { id, ...data } = originalSettings;
      await prisma.siteSettings.update({
        where: { id },
        data,
      });
    }
  });

  beforeEach(async () => {
    await cleanupM1TestRows();
  });

  afterEach(async () => {
    await cleanupM1TestRows();
  });

  it("Scenario 1: Prepaid (RAZORPAY) - quote payable equals create-order amount", async () => {
    const user = await createTestUser();
    const session = await createSessionCookie(user.id);
    const { product, variants } = await createTestProduct({ price: 100000, variants: [{ size: Size.M, stock: 5 }] });
    const items = [{ productId: product.id, variantId: variants[0].id, qty: 1 }];

    // Quote
    const quoteRes = await fetch(`${BASE_URL}/api/checkout/quote`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: session.headerValue },
      body: JSON.stringify({ items, paymentMethod: "RAZORPAY" }),
    });
    expect(quoteRes.status).toBe(200);
    const quoteData = await quoteRes.json();

    // Create Order
    const createRes = await fetch(`${BASE_URL}/api/checkout/create-order`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: session.headerValue },
      body: JSON.stringify({
        idempotencyKey: crypto.randomUUID(),
        items,
        paymentMethod: "RAZORPAY",
        customerName: "T29 User",
        customerPhone: "9876543210",
        shippingAddress: { line1: "123 Street", city: "City", state: "State", pincode: "110001" },
      }),
    });
    expect(createRes.status).toBe(200);
    const createData = await createRes.json();

    expect(quoteData.payable).toBe(createData.amount);
    expect(quoteData.shippingFee).toBe(0); // Free prepaid
    expect(createData.amount).toBe(100000);
  });

  it("Scenario 2: COD - quote payable equals create-order amount including COD fee", async () => {
    const user = await createTestUser();
    const session = await createSessionCookie(user.id);
    const { product, variants } = await createTestProduct({ price: 100000, variants: [{ size: Size.M, stock: 5 }] });
    const items = [{ productId: product.id, variantId: variants[0].id, qty: 1 }];

    const quoteRes = await fetch(`${BASE_URL}/api/checkout/quote`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: session.headerValue },
      body: JSON.stringify({ items, paymentMethod: "COD" }),
    });
    expect(quoteRes.status).toBe(200);
    const quoteData = await quoteRes.json();

    const createRes = await fetch(`${BASE_URL}/api/checkout/create-order`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: session.headerValue },
      body: JSON.stringify({
        idempotencyKey: crypto.randomUUID(),
        items,
        paymentMethod: "COD",
        customerName: "T29 User",
        customerPhone: "9876543210",
        shippingAddress: { line1: "123 Street", city: "City", state: "State", pincode: "110001" },
      }),
    });
    expect(createRes.status).toBe(200);
    const createData = await createRes.json();

    expect(createData.isCod).toBe(true);
    expect(quoteData.payable).toBe(createData.amount);
    // Subtotal 100000 + shippingFee 9900 + codFee 5000 = 114900
    expect(createData.amount).toBe(114900);
  });

  it("Scenario 3: Coupon - quote payable equals create-order amount with coupon discount", async () => {
    const user = await createTestUser();
    const session = await createSessionCookie(user.id);
    const { product, variants } = await createTestProduct({ price: 100000, variants: [{ size: Size.M, stock: 5 }] });
    const coupon = await createTestCoupon({ discountType: "FLAT", value: 20000 });
    const items = [{ productId: product.id, variantId: variants[0].id, qty: 1 }];

    const quoteRes = await fetch(`${BASE_URL}/api/checkout/quote`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: session.headerValue },
      body: JSON.stringify({ items, paymentMethod: "RAZORPAY", couponCode: coupon.code }),
    });
    expect(quoteRes.status).toBe(200);
    const quoteData = await quoteRes.json();
    expect(quoteData.discount).toBe(20000);

    const createRes = await fetch(`${BASE_URL}/api/checkout/create-order`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: session.headerValue },
      body: JSON.stringify({
        idempotencyKey: crypto.randomUUID(),
        items,
        paymentMethod: "RAZORPAY",
        couponCode: coupon.code,
        customerName: "T29 User",
        customerPhone: "9876543210",
        shippingAddress: { line1: "123 Street", city: "City", state: "State", pincode: "110001" },
      }),
    });
    expect(createRes.status).toBe(200);
    const createData = await createRes.json();

    expect(quoteData.payable).toBe(createData.amount);
    expect(createData.amount).toBe(80000);
  });

  it("Scenario 4: Partial store credit - quote payable equals create-order amount", async () => {
    const user = await createTestUser({ storeCreditBalance: 40000 });
    const session = await createSessionCookie(user.id);
    const { product, variants } = await createTestProduct({ price: 100000, variants: [{ size: Size.M, stock: 5 }] });
    const items = [{ productId: product.id, variantId: variants[0].id, qty: 1 }];

    const quoteRes = await fetch(`${BASE_URL}/api/checkout/quote`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: session.headerValue },
      body: JSON.stringify({ items, paymentMethod: "RAZORPAY", useStoreCredit: true }),
    });
    expect(quoteRes.status).toBe(200);
    const quoteData = await quoteRes.json();
    expect(quoteData.storeCreditApplied).toBe(40000);

    const createRes = await fetch(`${BASE_URL}/api/checkout/create-order`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: session.headerValue },
      body: JSON.stringify({
        idempotencyKey: crypto.randomUUID(),
        items,
        paymentMethod: "RAZORPAY",
        useStoreCredit: true,
        customerName: "T29 User",
        customerPhone: "9876543210",
        shippingAddress: { line1: "123 Street", city: "City", state: "State", pincode: "110001" },
      }),
    });
    expect(createRes.status).toBe(200);
    const createData = await createRes.json();

    expect(quoteData.payable).toBe(createData.amount);
    expect(createData.amount).toBe(60000);
  });

  it("Scenario 5: Full store credit - quote payable 0 equals create-order payableAmount 0", async () => {
    const user = await createTestUser({ storeCreditBalance: 200000 });
    const session = await createSessionCookie(user.id);
    const { product, variants } = await createTestProduct({ price: 100000, variants: [{ size: Size.M, stock: 5 }] });
    const items = [{ productId: product.id, variantId: variants[0].id, qty: 1 }];

    const quoteRes = await fetch(`${BASE_URL}/api/checkout/quote`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: session.headerValue },
      body: JSON.stringify({ items, paymentMethod: "RAZORPAY", useStoreCredit: true }),
    });
    expect(quoteRes.status).toBe(200);
    const quoteData = await quoteRes.json();
    expect(quoteData.payable).toBe(0);
    expect(quoteData.storeCreditApplied).toBe(100000);

    const createRes = await fetch(`${BASE_URL}/api/checkout/create-order`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: session.headerValue },
      body: JSON.stringify({
        idempotencyKey: crypto.randomUUID(),
        items,
        paymentMethod: "RAZORPAY",
        useStoreCredit: true,
        customerName: "T29 User",
        customerPhone: "9876543210",
        shippingAddress: { line1: "123 Street", city: "City", state: "State", pincode: "110001" },
      }),
    });
    expect(createRes.status).toBe(200);
    const createData = await createRes.json();

    expect(createData.isStoreCredit).toBe(true);
    expect(createData.payableAmount).toBe(0);
    expect(quoteData.payable).toBe(createData.payableAmount);
  });

  it("Scenario 6: Mixed (Coupon + Store Credit + Prepaid)", async () => {
    const user = await createTestUser({ storeCreditBalance: 30000 });
    const session = await createSessionCookie(user.id);
    const { product, variants } = await createTestProduct({ price: 100000, variants: [{ size: Size.M, stock: 5 }] });
    const coupon = await createTestCoupon({ discountType: "FLAT", value: 20000 });
    const items = [{ productId: product.id, variantId: variants[0].id, qty: 1 }];

    const quoteRes = await fetch(`${BASE_URL}/api/checkout/quote`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: session.headerValue },
      body: JSON.stringify({ items, paymentMethod: "RAZORPAY", couponCode: coupon.code, useStoreCredit: true }),
    });
    expect(quoteRes.status).toBe(200);
    const quoteData = await quoteRes.json();
    expect(quoteData.discount).toBe(20000);
    expect(quoteData.storeCreditApplied).toBe(30000);
    expect(quoteData.payable).toBe(50000);

    const createRes = await fetch(`${BASE_URL}/api/checkout/create-order`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: session.headerValue },
      body: JSON.stringify({
        idempotencyKey: crypto.randomUUID(),
        items,
        paymentMethod: "RAZORPAY",
        couponCode: coupon.code,
        useStoreCredit: true,
        customerName: "T29 User",
        customerPhone: "9876543210",
        shippingAddress: { line1: "123 Street", city: "City", state: "State", pincode: "110001" },
      }),
    });
    expect(createRes.status).toBe(200);
    const createData = await createRes.json();

    expect(quoteData.payable).toBe(createData.amount);
    expect(createData.amount).toBe(50000);
  });
});

