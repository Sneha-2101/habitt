import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from "vitest";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
  notFound: vi.fn(),
}));

import { prisma } from "../helpers/prisma";
import * as guardsModule from "@/lib/guards";
import { type GuardUser, ForbiddenError } from "@/lib/guards";
import {
  nameDefaultColorAction,
  addColorAction,
  renameColorAction,
  removeColorAction,
  setVariantSkuAction,
} from "@/lib/actions/variants";
import { createTestUser, createTestProduct, cleanupM1TestRows, genId } from "../helpers/fixtures";

describe("T73: Variant Colors, SKUs, and Compound Uniqueness", () => {
  const createdProductIds: string[] = [];
  const createdOrderIds: string[] = [];
  const testUserIds: string[] = [];

  beforeAll(async () => {
    await cleanupM1TestRows();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    if (createdOrderIds.length > 0) {
      await prisma.orderItem.deleteMany({ where: { orderId: { in: createdOrderIds } } });
      await prisma.orderStatusEvent.deleteMany({ where: { orderId: { in: createdOrderIds } } });
      await prisma.order.deleteMany({ where: { id: { in: createdOrderIds } } });
    }
    if (createdProductIds.length > 0) {
      const m1ProductIds = createdProductIds.filter((id) => id.startsWith("m1test"));
      if (m1ProductIds.length > 0) {
        await prisma.cartItem.deleteMany({ where: { productId: { in: m1ProductIds } } });
        await prisma.stockNotification.deleteMany({ where: { productId: { in: m1ProductIds } } });
        await prisma.productVariant.deleteMany({ where: { productId: { in: m1ProductIds } } });
        await prisma.productImage.deleteMany({ where: { productId: { in: m1ProductIds } } });
        await prisma.auditLog.deleteMany({ where: { entityId: { in: m1ProductIds } } });
        await prisma.product.deleteMany({ where: { id: { in: m1ProductIds } } });
      }
    }
    if (testUserIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: testUserIds } } });
    }
    await cleanupM1TestRows();
  });

  function mockStaffUser(user: { id: string; email?: string | null; name?: string | null }) {
    vi.spyOn(guardsModule, "requireStaff").mockResolvedValue({
      id: user.id,
      email: user.email ?? `${user.id}@habitt.test`,
      name: user.name ?? "Staff User",
      role: "STAFF",
    } as GuardUser);
  }

  function mockCustomerUser() {
    vi.spyOn(guardsModule, "requireStaff").mockRejectedValue(new ForbiddenError());
  }

  it("1. CUSTOMER is rejected on all variant management actions", async () => {
    const customer = await createTestUser({ email: `${genId("m1test_cust")}@habitt.test`, role: "CUSTOMER" });
    testUserIds.push(customer.id);
    mockCustomerUser();

    await expect(nameDefaultColorAction("dummy_prod", "Navy", "#000080")).rejects.toThrow();
    await expect(addColorAction("dummy_prod", "Olive", "#808000", 5)).rejects.toThrow();
    await expect(renameColorAction("dummy_prod", "Navy", "Dark Navy")).rejects.toThrow();
    await expect(removeColorAction("dummy_prod", "Navy")).rejects.toThrow();
    await expect(setVariantSkuAction("dummy_var", "SKU-001")).rejects.toThrow();
  });

  it("2. nameDefaultColor works once and is rejected afterwards; writes AuditLog row", async () => {
    const staff = await createTestUser({ email: `${genId("m1test_staff")}@habitt.test`, role: "STAFF" });
    testUserIds.push(staff.id);
    mockStaffUser(staff);

    const { product } = await createTestProduct({
      variants: [
        { size: "S", stock: 10 },
        { size: "M", stock: 15 },
      ],
    });
    createdProductIds.push(product.id);

    // Initial variants have color ""
    const initialVars = await prisma.productVariant.findMany({ where: { productId: product.id } });
    expect(initialVars.every((v) => v.color === "")).toBe(true);

    // 1st call should succeed
    const res = await nameDefaultColorAction(product.id, "Midnight Navy", "#000080");
    expect(res.success).toBe(true);

    const updatedVars = await prisma.productVariant.findMany({ where: { productId: product.id } });
    expect(updatedVars.every((v) => v.color === "Midnight Navy")).toBe(true);
    expect(updatedVars.every((v) => v.colorHex === "#000080")).toBe(true);

    // Audit log check
    const audit = await prisma.auditLog.findFirst({
      where: {
        entityId: product.id,
        action: "variant.color.name",
      },
      orderBy: { createdAt: "desc" },
    });
    expect(audit).not.toBeNull();
    expect(audit?.actorId).toBe(staff.id);

    // 2nd call should be rejected because variants now have non-empty color
    await expect(nameDefaultColorAction(product.id, "Charcoal")).rejects.toThrow();
  });

  it("3. addColor rejected while a '' variant exists; works after naming (creates variants for distinct sizes); duplicate rejected case-insensitively", async () => {
    const staff = await createTestUser({ email: `${genId("m1test_staff")}@habitt.test`, role: "STAFF" });
    testUserIds.push(staff.id);
    mockStaffUser(staff);

    const { product } = await createTestProduct({
      variants: [
        { size: "S", stock: 2 },
        { size: "M", stock: 3 },
        { size: "L", stock: 4 },
      ],
    });
    createdProductIds.push(product.id);

    // addColor must be rejected with exact message when "" variant exists
    await expect(addColorAction(product.id, "Olive", "#808000", 7)).rejects.toThrow(
      "Name the default color first"
    );

    // Name default color first
    await nameDefaultColorAction(product.id, "Black", "#000000");

    // Duplicate color rejected case-insensitively
    await expect(addColorAction(product.id, "black", "#000000", 5)).rejects.toThrow(
      /duplicate/i
    );
    await expect(addColorAction(product.id, "BLACK", "#000000", 5)).rejects.toThrow(
      /duplicate/i
    );

    // Add color Olive with stock 7
    const addRes = await addColorAction(product.id, "Olive", "#808000", 7);
    expect(addRes.success).toBe(true);

    const oliveVariants = await prisma.productVariant.findMany({
      where: { productId: product.id, color: "Olive" },
      orderBy: { size: "asc" },
    });
    // Distinct sizes on product were S, M, L
    expect(oliveVariants).toHaveLength(3);
    expect(oliveVariants.map((v) => v.size).sort()).toEqual(["L", "M", "S"]);
    expect(oliveVariants.every((v) => v.stock === 7)).toBe(true);
    expect(oliveVariants.every((v) => v.colorHex === "#808000")).toBe(true);

    // Audit log check
    const audit = await prisma.auditLog.findFirst({
      where: {
        entityId: product.id,
        action: "variant.color.add",
      },
      orderBy: { createdAt: "desc" },
    });
    expect(audit).not.toBeNull();
    expect(audit?.actorId).toBe(staff.id);
  });

  it("4. renameColorAction renames all variants, rejects duplicates (case-insensitive) and empty name; writes AuditLog row", async () => {
    const staff = await createTestUser({ email: `${genId("m1test_staff")}@habitt.test`, role: "STAFF" });
    testUserIds.push(staff.id);
    mockStaffUser(staff);

    const { product } = await createTestProduct({
      variants: [{ size: "M", stock: 5 }],
    });
    createdProductIds.push(product.id);

    await nameDefaultColorAction(product.id, "Slate Grey", "#708090");
    await addColorAction(product.id, "Olive", "#808000", 3);

    // Reject empty name
    await expect(renameColorAction(product.id, "Olive", "")).rejects.toThrow();

    // Reject duplicate name case-insensitively
    await expect(renameColorAction(product.id, "Olive", "slate grey")).rejects.toThrow(
      /duplicate/i
    );

    // Successful rename
    const renameRes = await renameColorAction(product.id, "Olive", "Forest Olive", "#556B2F");
    expect(renameRes.success).toBe(true);

    const renamedVars = await prisma.productVariant.findMany({
      where: { productId: product.id, color: "Forest Olive" },
    });
    expect(renamedVars).toHaveLength(1);
    expect(renamedVars[0].colorHex).toBe("#556B2F");

    const oldVars = await prisma.productVariant.findMany({
      where: { productId: product.id, color: "Olive" },
    });
    expect(oldVars).toHaveLength(0);

    // Audit log check
    const audit = await prisma.auditLog.findFirst({
      where: {
        entityId: product.id,
        action: "variant.color.rename",
      },
      orderBy: { createdAt: "desc" },
    });
    expect(audit).not.toBeNull();
  });

  it("5. removeColorAction rejected when OrderItem references color or when it is the only color; deletes variants otherwise; writes AuditLog row", async () => {
    const staff = await createTestUser({ email: `${genId("m1test_staff")}@habitt.test`, role: "STAFF" });
    testUserIds.push(staff.id);
    mockStaffUser(staff);

    const { product } = await createTestProduct({
      variants: [{ size: "M", stock: 10 }],
    });
    createdProductIds.push(product.id);

    await nameDefaultColorAction(product.id, "Navy", "#000080");

    // Reject when it is the product's only color
    await expect(removeColorAction(product.id, "Navy")).rejects.toThrow(
      /only color/i
    );

    // Add a second color
    await addColorAction(product.id, "Olive", "#808000", 5);

    // Create a dummy order referencing the Olive variant
    const oliveVar = await prisma.productVariant.findFirstOrThrow({
      where: { productId: product.id, color: "Olive" },
    });

    const orderId = genId("m1test_ord");
    createdOrderIds.push(orderId);
    await prisma.order.create({
      data: {
        id: orderId,
        displayId: `m1test-${Date.now()}`,
        userId: staff.id,
        customerName: "Staff Tester",
        customerPhone: "+919876543210",
        shippingAddress: { addressLine1: "123 Test St", city: "Bengaluru", state: "Karnataka", pincode: "560001" },
        subtotal: 1000,
        shippingFee: 0,
        total: 1000,
        items: {
          create: {
            productId: product.id,
            variantId: oliveVar.id,
            name: product.name,
            size: oliveVar.size,
            color: oliveVar.color,
            unitPrice: 1000,
            qty: 1,
          },
        },
      },
    });

    // Remove Olive should now be rejected because of OrderItem reference
    await expect(removeColorAction(product.id, "Olive")).rejects.toThrow(
      /orders/i
    );

    // Add a third color Maroon with no orders
    await addColorAction(product.id, "Maroon", "#800000", 4);
    const maroonVar = await prisma.productVariant.findFirstOrThrow({
      where: { productId: product.id, color: "Maroon" },
    });

    // Also add a cart item and stock notification to verify cascade/deletion
    const cart = await prisma.cart.create({ data: { userId: staff.id } });
    await prisma.cartItem.create({
      data: {
        cartId: cart.id,
        productId: product.id,
        variantId: maroonVar.id,
        qty: 1,
      },
    });
    await prisma.stockNotification.create({
      data: {
        email: "notify@test.com",
        productId: product.id,
        variantId: maroonVar.id,
      },
    });

    // Remove Maroon should succeed
    const removeRes = await removeColorAction(product.id, "Maroon");
    expect(removeRes.success).toBe(true);

    const remainingMaroon = await prisma.productVariant.findMany({
      where: { productId: product.id, color: "Maroon" },
    });
    expect(remainingMaroon).toHaveLength(0);

    const notifCheck = await prisma.stockNotification.findMany({
      where: { variantId: maroonVar.id },
    });
    expect(notifCheck).toHaveLength(0);

    // Audit log check
    const audit = await prisma.auditLog.findFirst({
      where: {
        entityId: product.id,
        action: "variant.color.remove",
      },
      orderBy: { createdAt: "desc" },
    });
    expect(audit).not.toBeNull();
  });

  it("6. setVariantSku stores normalised uppercase, rejects duplicate across products, empty clears; writes AuditLog row", async () => {
    const staff = await createTestUser({ email: `${genId("m1test_staff")}@habitt.test`, role: "STAFF" });
    testUserIds.push(staff.id);
    mockStaffUser(staff);

    const { product: prod1, variants: vars1 } = await createTestProduct({
      variants: [{ size: "M", stock: 5 }],
    });
    const { product: prod2, variants: vars2 } = await createTestProduct({
      variants: [{ size: "M", stock: 5 }],
    });
    createdProductIds.push(prod1.id, prod2.id);

    const var1 = vars1[0];
    const var2 = vars2[0];

    // Set SKU with lowercase and spaces -> stored in normalised upper case
    const setRes = await setVariantSkuAction(var1.id, "  hab-tee-m  ");
    expect(setRes.success).toBe(true);
    expect(setRes.sku).toBe("HAB-TEE-M");

    const checkedVar1 = await prisma.productVariant.findUnique({ where: { id: var1.id } });
    expect(checkedVar1?.sku).toBe("HAB-TEE-M");

    // Setting same SKU on another product variant must reject
    await expect(setVariantSkuAction(var2.id, "hab-tee-m")).rejects.toThrow(/taken/i);
    await expect(setVariantSkuAction(var2.id, "HAB-TEE-M")).rejects.toThrow(/taken/i);

    // Empty clears SKU
    const clearRes = await setVariantSkuAction(var1.id, "   ");
    expect(clearRes.success).toBe(true);
    expect(clearRes.sku).toBeNull();

    const clearedVar1 = await prisma.productVariant.findUnique({ where: { id: var1.id } });
    expect(clearedVar1?.sku).toBeNull();

    // Now var2 can take that SKU
    const var2Res = await setVariantSkuAction(var2.id, "HAB-TEE-M");
    expect(var2Res.success).toBe(true);
    expect(var2Res.sku).toBe("HAB-TEE-M");

    // Audit log check
    const audit = await prisma.auditLog.findFirst({
      where: {
        entityId: var2.id,
        action: "variant.sku.set",
      },
      orderBy: { createdAt: "desc" },
    });
    expect(audit).not.toBeNull();
  });

  it("7. DB unique (productId, size, color) holds: a direct create of duplicate throws", async () => {
    const { product } = await createTestProduct({
      variants: [{ size: "XL", stock: 5 }],
    });
    createdProductIds.push(product.id);

    // Initial variant is (product.id, "XL", "")
    // Attempting to directly insert another variant with identical (product.id, "XL", "") must throw
    await expect(
      prisma.productVariant.create({
        data: {
          productId: product.id,
          size: "XL",
          color: "",
          stock: 10,
        },
      })
    ).rejects.toThrow();

    // But inserting (product.id, "XL", "Navy") succeeds!
    const navyVar = await prisma.productVariant.create({
      data: {
        productId: product.id,
        size: "XL",
        color: "Navy",
        stock: 10,
      },
    });
    expect(navyVar.id).toBeDefined();

    // And duplicate (product.id, "XL", "Navy") throws!
    await expect(
      prisma.productVariant.create({
        data: {
          productId: product.id,
          size: "XL",
          color: "Navy",
          stock: 3,
        },
      })
    ).rejects.toThrow();
  });
});
