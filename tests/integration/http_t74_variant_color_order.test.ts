import { describe, it, expect, beforeEach, afterEach } from "vitest";
import crypto from "crypto";
import { prisma } from "../helpers/prisma";
import {
  createTestUser,
  createTestProduct,
  cleanupM1TestRows,
} from "../helpers/fixtures";
import { createSessionCookie } from "../helpers/session";

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3000";

describe("T74: Variant Color & SKU Order Snapshots", () => {
  beforeEach(async () => {
    await cleanupM1TestRows();
  });

  afterEach(async () => {
    await cleanupM1TestRows();
  });

  it("orders snapshot variant color and sku; stock decrements only for ordered variant; no-color product snapshots color as ''", async () => {
    const originalSettings = await prisma.siteSettings.findUnique({ where: { id: "default" } });
    const saved = {
      codEnabled: originalSettings?.codEnabled,
      codRequiresDeliveredOrder: originalSettings?.codRequiresDeliveredOrder,
      codOrderCap: originalSettings?.codOrderCap,
    };

    // Enable COD without requiring prior delivered orders so test can place COD orders directly
    await prisma.siteSettings.upsert({
      where: { id: "default" },
      update: {
        codEnabled: true,
        codRequiresDeliveredOrder: false,
        codOrderCap: 500000,
      },
      create: {
        id: "default",
        codEnabled: true,
        codRequiresDeliveredOrder: false,
        codOrderCap: 500000,
      },
    });

    try {
      const user = await createTestUser();
      const session = await createSessionCookie(user.id);

      // 1. Create a product with two colored variants: Navy M and Olive M
      const { product: coloredProduct, variants: coloredVariants } = await createTestProduct({
        price: 150000, // Rs 1500
        variants: [
          { size: "M", color: "Navy", colorHex: "#000080", sku: "M1TEST-TEE-NAVY-M", stock: 5 },
          { size: "M", color: "Olive", colorHex: "#808000", sku: "M1TEST-TEE-OLIVE-M", stock: 5 },
        ],
      });

      const navyVariant = coloredVariants.find((v) => v.color === "Navy")!;
      const oliveVariant = coloredVariants.find((v) => v.color === "Olive")!;
      expect(navyVariant).toBeDefined();
      expect(oliveVariant).toBeDefined();

      // Assert POST /api/checkout/quote returns items with color set and NO "sku" key
      const quoteRes = await fetch(`${BASE_URL}/api/checkout/quote`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: session.headerValue },
        body: JSON.stringify({
          items: [{ productId: coloredProduct.id, variantId: oliveVariant.id, qty: 1 }],
          paymentMethod: "COD",
        }),
      });
      expect(quoteRes.status).toBe(200);
      const quoteData = await quoteRes.json();
      expect(quoteData.items).toBeDefined();
      expect(quoteData.items.length).toBe(1);
      const quotedOliveItem = quoteData.items[0];
      expect(quotedOliveItem.color).toBe("Olive");
      expect("sku" in quotedOliveItem).toBe(false);

      // 2. Create a no-color product
      const { product: noColorProduct, variants: noColorVariants } = await createTestProduct({
        price: 120000, // Rs 1200
        variants: [
          { size: "L", color: "", colorHex: null, sku: "M1TEST-SHIRT-NOCOLOR-L", stock: 10 },
        ],
      });
      const noColorVariant = noColorVariants[0];
      expect(noColorVariant).toBeDefined();

      // 3. Place a COD order for the Olive variant
      const olivePayload = {
        idempotencyKey: crypto.randomUUID(),
        items: [{ productId: coloredProduct.id, variantId: oliveVariant.id, qty: 1 }],
        customerName: "Olive Customer",
        customerPhone: "9876543210",
        shippingAddress: { line1: "Street 1", city: "Bengaluru", state: "KA", pincode: "560001" },
        paymentMethod: "COD",
        useStoreCredit: false,
      };

      const oliveRes = await fetch(`${BASE_URL}/api/checkout/create-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: session.headerValue },
        body: JSON.stringify(olivePayload),
      });

      expect(oliveRes.status).toBe(200);
      const oliveData = await oliveRes.json();
      expect(oliveData.isCod).toBe(true);

      const oliveOrder = await prisma.order.findUnique({
        where: { id: oliveData.orderId },
        include: { items: true },
      });

      expect(oliveOrder).not.toBeNull();
      expect(oliveOrder?.items).toHaveLength(1);
      const oliveOrderItem = oliveOrder!.items[0];

      // Assert OrderItem.color === "Olive" and OrderItem.sku === oliveVariant.sku
      expect(oliveOrderItem.color).toBe("Olive");
      expect(oliveOrderItem.sku).toBe("M1TEST-TEE-OLIVE-M");
      expect(oliveOrderItem.size).toBe("M");

      // Assert stock decremented ONLY for the Olive variant
      const checkedOliveVar = await prisma.productVariant.findUnique({ where: { id: oliveVariant.id } });
      const checkedNavyVar = await prisma.productVariant.findUnique({ where: { id: navyVariant.id } });

      expect(checkedOliveVar?.stock).toBe(4);
      expect(checkedNavyVar?.stock).toBe(5); // unchanged!

      // 4. Place a COD order for the no-color product
      const noColorPayload = {
        idempotencyKey: crypto.randomUUID(),
        items: [{ productId: noColorProduct.id, variantId: noColorVariant.id, qty: 1 }],
        customerName: "No Color Customer",
        customerPhone: "9876543210",
        shippingAddress: { line1: "Street 2", city: "Bengaluru", state: "KA", pincode: "560001" },
        paymentMethod: "COD",
        useStoreCredit: false,
      };

      const noColorRes = await fetch(`${BASE_URL}/api/checkout/create-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: session.headerValue },
        body: JSON.stringify(noColorPayload),
      });

      expect(noColorRes.status).toBe(200);
      const noColorData = await noColorRes.json();
      expect(noColorData.isCod).toBe(true);

      const noColorOrder = await prisma.order.findUnique({
        where: { id: noColorData.orderId },
        include: { items: true },
      });

      expect(noColorOrder).not.toBeNull();
      expect(noColorOrder?.items).toHaveLength(1);
      const noColorOrderItem = noColorOrder!.items[0];

      // Assert that an order for a no-color product has color ""
      expect(noColorOrderItem.color).toBe("");
      expect(noColorOrderItem.sku).toBe("M1TEST-SHIRT-NOCOLOR-L");
      expect(noColorOrderItem.size).toBe("L");

      const checkedNoColorVar = await prisma.productVariant.findUnique({ where: { id: noColorVariant.id } });
      expect(checkedNoColorVar?.stock).toBe(9);
    } finally {
      if (saved.codEnabled !== undefined) {
        await prisma.siteSettings.update({
          where: { id: "default" },
          data: {
            codEnabled: saved.codEnabled,
            codRequiresDeliveredOrder: saved.codRequiresDeliveredOrder,
            codOrderCap: saved.codOrderCap,
          },
        });
      }
    }
  });
});
