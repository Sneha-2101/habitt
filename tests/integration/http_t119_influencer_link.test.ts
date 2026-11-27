import { describe, it, expect, beforeEach, afterEach } from "vitest";
import crypto from "crypto";
import { prisma } from "../helpers/prisma";
import {
  createTestUser,
  createTestProduct,
  cleanupM1TestRows,
  genId,
} from "../helpers/fixtures";
import { createSessionCookie } from "../helpers/session";

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3000";

describe("T119: HTTP Influencer Link (/i/[code]) & Create-Order Attribution", () => {
  beforeEach(async () => {
    await cleanupM1TestRows();
  });

  afterEach(async () => {
    await cleanupM1TestRows();
  });

  it("sets habitt_inf identically for existing/missing codes, sets none for invalid syntax, and attributes orders with quote parity", async () => {
    // 1. Link endpoint behaviour
    const [validRes, missingRes, invalidRes] = await Promise.all([
      fetch(`${BASE_URL}/i/VALIDCODE`, { redirect: "manual" }),
      fetch(`${BASE_URL}/i/NOSUCHCODE`, { redirect: "manual" }),
      fetch(`${BASE_URL}/i/${encodeURIComponent("%%%")}`, { redirect: "manual" }),
    ]);

    expect(validRes.status).toBe(307);
    expect(missingRes.status).toBe(307);
    expect(invalidRes.status).toBe(307);
    expect(validRes.headers.get("location")).toBe(missingRes.headers.get("location"));
    expect(validRes.headers.get("set-cookie")).toContain("habitt_inf=VALIDCODE");
    expect(missingRes.headers.get("set-cookie")).toContain("habitt_inf=NOSUCHCODE");
    expect(invalidRes.headers.get("set-cookie")).toBeNull();

    // 2. Order attribution scenarios
    const user = await createTestUser();
    const session = await createSessionCookie(user.id);
    const { variants } = await createTestProduct({
      price: 150000,
      variants: [{ size: "M", stock: 20 }],
    });

    const codeA = genId("M1TEST_A").toUpperCase();
    const offerA = await prisma.offer.create({
      data: {
        id: genId("m1test_off"),
        name: "M1Test Inf A",
        kind: "PERCENT_OFF",
        code: codeA,
        active: true,
        audience: "ALL",
        config: { percent: 10 },
      },
    });
    const infA = await prisma.influencer.create({
      data: {
        id: genId("m1test_inf"),
        name: "M1Test Inf A",
        code: codeA,
        active: true,
        offerId: offerA.id,
      },
    });

    const codeB = genId("M1TEST_B").toUpperCase();
    const infB = await prisma.influencer.create({
      data: {
        id: genId("m1test_inf"),
        name: "M1Test Inf B",
        code: codeB,
        active: true,
      },
    });

    const codeInactive = genId("M1TEST_OFF_INF").toUpperCase();
    await prisma.influencer.create({
      data: {
        id: genId("m1test_inf"),
        name: "M1Test Inactive",
        code: codeInactive,
        active: false,
      },
    });

    const address = {
      name: "Test Customer",
      phone: "9876543210",
      email: user.email,
      line1: "123 Test St",
      city: "Mumbai",
      state: "Maharashtra",
      pincode: "400001",
    };

    const runOrder = async (opts: { cookieCode?: string; couponCode?: string }) => {
      const quoteRes = await fetch(`${BASE_URL}/api/checkout/quote`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: session.headerValue },
        body: JSON.stringify({
          items: [{ productId: variants[0].productId, variantId: variants[0].id, qty: 1 }],
          paymentMethod: "COD",
          couponCode: opts.couponCode,
        }),
      });
      const quote = await quoteRes.json();

      const cookieHeader = opts.cookieCode
        ? `${session.headerValue}; habitt_inf=${opts.cookieCode}`
        : session.headerValue;
      const idempotencyKey = crypto.randomUUID();
      const createRes = await fetch(`${BASE_URL}/api/checkout/create-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookieHeader },
        body: JSON.stringify({
          idempotencyKey,
          items: [{ productId: variants[0].productId, variantId: variants[0].id, qty: 1 }],
          paymentMethod: "COD",
          couponCode: opts.couponCode,
          customerName: address.name,
          customerPhone: address.phone,
          customerEmail: address.email,
          shippingAddress: address,
        }),
      });
      const bodyText = await createRes.text();
      expect(
        createRes.status,
        `create-order failed (${createRes.status}): ${bodyText}`
      ).toBe(200);
      const created = await prisma.order.findUniqueOrThrow({
        where: { idempotencyKey },
      });
      expect(created.total).toBe(quote.total);
      return created;
    };

    // Cookie B -> LINK for B
    const orderLink = await runOrder({ cookieCode: codeB });
    expect(orderLink.influencerId).toBe(infB.id);
    expect(orderLink.influencerSource).toBe("LINK");

    // Coupon A -> COUPON for A
    const orderCoupon = await runOrder({ couponCode: codeA });
    expect(orderCoupon.influencerId).toBe(infA.id);
    expect(orderCoupon.influencerSource).toBe("COUPON");

    // Cookie B + Coupon A -> COUPON for A wins
    const orderBoth = await runOrder({ cookieCode: codeB, couponCode: codeA });
    expect(orderBoth.influencerId).toBe(infA.id);
    expect(orderBoth.influencerSource).toBe("COUPON");

    // Inactive cookie -> null
    const orderInactive = await runOrder({ cookieCode: codeInactive });
    expect(orderInactive.influencerId).toBeNull();
    expect(orderInactive.influencerSource).toBeNull();

    // Lowercase coupon -> COUPON for A
    const orderLower = await runOrder({ couponCode: codeA.toLowerCase() });
    expect(orderLower.influencerId).toBe(infA.id);
    expect(orderLower.influencerSource).toBe("COUPON");
  });
});
