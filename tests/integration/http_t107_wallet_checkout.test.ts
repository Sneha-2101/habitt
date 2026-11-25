import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import crypto from "crypto";
import { prisma } from "../helpers/prisma";
import {
  cleanupM1TestRows,
  createTestProduct,
  createTestUser,
} from "../helpers/fixtures";
import { createSessionCookie } from "../helpers/session";
import { creditWalletLot, getWalletBalance } from "@/lib/wallet/service";
import { cancelOrderAsCustomer } from "@/lib/actions/cancellation";
import { markCodRefused } from "@/lib/actions/cod-refusal";
import { failOrder } from "@/lib/orders/fail-order";
import { issueRefund } from "@/lib/refunds/issue-refund";
import * as guardsModule from "@/lib/guards";
import { SiteSettings } from "@prisma/client";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3000";

describe("T107: Wallet Checkout, Parity, Restores, Refunds & /account/wallet (HTTP)", () => {
  let originalSettings: SiteSettings | null = null;

  beforeAll(async () => {
    originalSettings = await prisma.siteSettings.findUnique({ where: { id: "default" } });
    await cleanupM1TestRows();
  });

  afterAll(async () => {
    try {
      if (originalSettings) {
        const { id: _id, updatedAt: _up, ...rest } = originalSettings;
        void _id;
        void _up;
        await prisma.siteSettings.upsert({
          where: { id: "default" },
          create: { id: "default", ...rest },
          update: { ...rest },
        });
      }
    } finally {
      await cleanupM1TestRows();
    }
  });

  it("quote & create-order respect walletMaxPercentOfOrder=50, maintain parity, and debit wallet", async () => {
    await prisma.siteSettings.update({
      where: { id: "default" },
      data: { walletMaxPercentOfOrder: 50, freeShippingThreshold: 0, shippingFee: 0 },
    });

    const user = await createTestUser();
    await creditWalletLot({ userId: user.id, kind: "REFUND", amountPaise: 200000, reason: "T107 seed" });
    const session = await createSessionCookie(user.id);
    const { product, variants } = await createTestProduct({ price: 100000, variants: [{ size: "M", stock: 5 }] });
    const items = [{ productId: product.id, variantId: variants[0].id, qty: 1 }];

    const quoteRes = await fetch(`${BASE_URL}/api/checkout/quote`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: session.headerValue },
      body: JSON.stringify({ items, paymentMethod: "RAZORPAY", useStoreCredit: true }),
    });
    expect(quoteRes.status).toBe(200);
    const quoteData = await quoteRes.json();
    expect(quoteData.storeCreditApplied).toBe(50000);
    expect(quoteData.payable).toBe(50000);

    const createRes = await fetch(`${BASE_URL}/api/checkout/create-order`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: session.headerValue },
      body: JSON.stringify({
        idempotencyKey: crypto.randomUUID(),
        items,
        paymentMethod: "RAZORPAY",
        useStoreCredit: true,
        customerName: "T107 User",
        customerPhone: "9876543210",
        shippingAddress: { line1: "123 St", city: "City", state: "State", pincode: "110001" },
      }),
    });
    expect(createRes.status).toBe(200);
    const createData = await createRes.json();
    expect(createData.amount).toBe(quoteData.payable);

    expect(await getWalletBalance(prisma, user.id)).toBe(150000);

    // Cancel order -> restores 50000 to wallet
    vi.spyOn(guardsModule, "requireUser").mockResolvedValueOnce({ id: user.id, role: "CUSTOMER" });
    await cancelOrderAsCustomer(createData.orderId, "Changed mind");
    expect(await getWalletBalance(prisma, user.id)).toBe(200000);
  });

  it("restores wallet on failed order, COD refusal, and creates REFUND lot on COD store-credit refund", async () => {
    await prisma.siteSettings.update({
      where: { id: "default" },
      data: { walletMaxPercentOfOrder: 100, freeShippingThreshold: 0, shippingFee: 0, codEnabled: true, codRequiresDeliveredOrder: false, codFeeEnabled: false },
    });

    const user = await createTestUser();
    await creditWalletLot({ userId: user.id, kind: "REFUND", amountPaise: 50000, reason: "T107 seed 2" });
    const session = await createSessionCookie(user.id);
    const { product, variants } = await createTestProduct({ price: 100000, variants: [{ size: "M", stock: 10 }] });
    const items = [{ productId: product.id, variantId: variants[0].id, qty: 1 }];

    // 1. Failed order restore
    const failCreate = await fetch(`${BASE_URL}/api/checkout/create-order`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: session.headerValue },
      body: JSON.stringify({
        idempotencyKey: crypto.randomUUID(),
        items,
        paymentMethod: "RAZORPAY",
        useStoreCredit: true,
        customerName: "T107 Fail",
        customerPhone: "9876543210",
        shippingAddress: { line1: "123 St", city: "City", state: "State", pincode: "110001" },
      }),
    });
    const failData = await failCreate.json();
    expect(await getWalletBalance(prisma, user.id)).toBe(0);

    const ordToFail = await prisma.order.findUniqueOrThrow({
      where: { id: failData.orderId },
      include: { items: true },
    });
    await prisma.$transaction((tx) => failOrder(tx, ordToFail, "Timed out"));
    expect(await getWalletBalance(prisma, user.id)).toBe(50000);

    // 2. COD refusal restore
    const codCreate = await fetch(`${BASE_URL}/api/checkout/create-order`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: session.headerValue },
      body: JSON.stringify({
        idempotencyKey: crypto.randomUUID(),
        items,
        paymentMethod: "COD",
        useStoreCredit: true,
        customerName: "T107 COD",
        customerPhone: "9876543210",
        shippingAddress: { line1: "123 St", city: "City", state: "State", pincode: "110001" },
      }),
    });
    const codData = await codCreate.json();
    expect(await getWalletBalance(prisma, user.id)).toBe(0);

    await prisma.order.update({ where: { id: codData.orderId }, data: { fulfilmentStatus: "SHIPPED" } });
    const staff = await createTestUser({ role: "STAFF" });
    vi.spyOn(guardsModule, "requireStaff").mockResolvedValueOnce({ id: staff.id, role: "STAFF" });
    await markCodRefused(codData.orderId, "Refused at door");
    expect(await getWalletBalance(prisma, user.id)).toBe(50000);

    // 3. COD order refunded to store credit creates a REFUND lot
    const codRefundOrder = await fetch(`${BASE_URL}/api/checkout/create-order`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: session.headerValue },
      body: JSON.stringify({
        idempotencyKey: crypto.randomUUID(),
        items,
        paymentMethod: "COD",
        useStoreCredit: false,
        customerName: "T107 Refund",
        customerPhone: "9876543210",
        shippingAddress: { line1: "123 St", city: "City", state: "State", pincode: "110001" },
      }),
    });
    const codRefData = await codRefundOrder.json();
    await issueRefund({
      orderId: codRefData.orderId,
      method: "STORE_CREDIT",
      amountPaise: 100000,
      idempotencyKey: `t107-ref-${codRefData.orderId}`,
      actorId: staff.id,
      reason: "COD return refund",
    });
    expect(await getWalletBalance(prisma, user.id)).toBe(150000);
  });

  it("/account/wallet shows balance for owner and redirects anonymous users", async () => {
    const anonRes = await fetch(`${BASE_URL}/account/wallet`, { redirect: "manual" });
    expect([302, 307]).toContain(anonRes.status);

    const user = await createTestUser();
    await creditWalletLot({ userId: user.id, kind: "REFUND", amountPaise: 42000, reason: "Page test" });
    const session = await createSessionCookie(user.id);

    const authRes = await fetch(`${BASE_URL}/account/wallet`, {
      headers: { Cookie: session.headerValue },
      redirect: "manual",
    });
    expect(authRes.status).toBe(200);
    const html = await authRes.text();
    expect(html).toContain("420");
  });
});
