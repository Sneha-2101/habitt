import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "../helpers/prisma";
import { cleanupM1TestRows, createTestProduct, createTestUser, genId } from "../helpers/fixtures";
import * as guardsModule from "@/lib/guards";
import { ForbiddenError } from "@/lib/guards";
import { renameCategorySizeAction, addMissingVariantsForCategoryAction } from "@/lib/actions/categories";
import { addMissingSizeVariantsAction } from "@/lib/actions/variants";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

describe("T94: Size and Variant Management Tools Integration", () => {
  let staffUser: { id: string; email: string; role: "STAFF" };
  let customerUser: { id: string; email: string; role: "CUSTOMER" };

  beforeAll(async () => {
    await cleanupM1TestRows();
    const s = await createTestUser({ role: "STAFF" });
    staffUser = { id: s.id, email: s.email!, role: "STAFF" };
    const c = await createTestUser({ role: "CUSTOMER" });
    customerUser = { id: c.id, email: c.email!, role: "CUSTOMER" };
  });

  afterAll(async () => {
    await cleanupM1TestRows();
  });

  function mockStaff() {
    vi.spyOn(guardsModule, "requireStaff").mockResolvedValue(
      staffUser as unknown as { id: string; email: string; role: "STAFF"; name: string }
    );
  }

  function mockCustomer() {
    vi.spyOn(guardsModule, "requireStaff").mockRejectedValue(
      new ForbiddenError("Staff role required")
    );
  }

  it("1. Non-staff callers are rejected from all size and variant tools", async () => {
    mockCustomer();

    await expect(
      renameCategorySizeAction("some-cat-id", "S", "Small")
    ).rejects.toThrow();

    await expect(
      addMissingSizeVariantsAction("some-prod-id")
    ).rejects.toThrow();

    await expect(
      addMissingVariantsForCategoryAction("some-cat-id")
    ).rejects.toThrow();
  });

  it("2. renameCategorySizeAction updates Category.sizes and variants, preserves OrderItem snapshots, and writes AuditLog", async () => {
    mockStaff();

    const cat = await prisma.category.create({
      data: {
        id: genId("m1test_cat"),
        slug: genId("m1test-cat"),
        name: "Renamable Category",
        sizes: ["S", "M", "L"],
      },
    });

    const prod = await createTestProduct({
      categoryId: cat.id,
      status: "ACTIVE",
      variants: [
        { size: "S", stock: 10, color: "Navy" },
        { size: "M", stock: 15, color: "Navy" },
      ],
    });

    // Create order item with size "S" snapshot
    const order = await prisma.order.create({
      data: {
        id: genId("m1test_ord"),
        displayId: "M1-ORD-RENAME",
        userId: customerUser.id,
        customerName: "Test",
        customerEmail: customerUser.email,
        customerPhone: "9876543210",
        shippingAddress: { city: "Amritsar", state: "Punjab" },
        subtotal: 100000,
        shippingFee: 0,
        total: 100000,
        items: {
          create: [
            {
              id: genId("m1test_oi"),
              productId: prod.product.id,
              variantId: prod.variants[0].id,
              name: prod.product.name,
              size: "S",
              color: "Navy",
              unitPrice: 100000,
              qty: 1,
            },
          ],
        },
      },
      include: { items: true },
    });

    // Rename "S" -> "Small"
    const res = await renameCategorySizeAction(cat.id, "S", "Small");
    expect(res.success).toBe(true);
    expect(res.renamedVariantsCount).toBe(1);

    // Verify Category sizes updated in place
    const updatedCat = await prisma.category.findUniqueOrThrow({ where: { id: cat.id } });
    expect(updatedCat.sizes).toEqual(["Small", "M", "L"]);

    // Verify variant size updated
    const updatedVariant = await prisma.productVariant.findUniqueOrThrow({
      where: { id: prod.variants[0].id },
    });
    expect(updatedVariant.size).toBe("Small");

    // Verify OrderItem snapshot is UNTOUCHED
    const orderItem = await prisma.orderItem.findUniqueOrThrow({
      where: { id: order.items[0].id },
    });
    expect(orderItem.size).toBe("S");

    // Verify AuditLog written
    const audit = await prisma.auditLog.findFirst({
      where: {
        action: "category.rename_size",
        entityId: cat.id,
      },
      orderBy: { createdAt: "desc" },
    });
    expect(audit).toBeDefined();
    const meta = audit?.meta as Record<string, unknown> | null;
    expect(meta?.from).toBe("S");
    expect(meta?.to).toBe("Small");
  });

  it("3. renameCategorySizeAction refuses collision with product list and makes no partial changes", async () => {
    mockStaff();

    const cat = await prisma.category.create({
      data: {
        id: genId("m1test_cat"),
        slug: genId("m1test-cat"),
        name: "Colliding Category",
        sizes: ["S", "M", "L"],
      },
    });

    // Product has both "S" and "M" in color "Navy"
    const prod = await createTestProduct({
      categoryId: cat.id,
      status: "ACTIVE",
      variants: [
        { size: "S", stock: 10, color: "Navy" },
        { size: "M", stock: 15, color: "Navy" },
      ],
    });

    // Try to rename "S" to "M" - must fail because Category already has "M" and product has "M"
    await expect(
      renameCategorySizeAction(cat.id, "S", "M")
    ).rejects.toThrow(/already contains size "M"/);

    // Try renaming when sizes wouldn't collide in category definition but product variants would
    // e.g. rename "S" -> "Small" when product already has a variant with size "Small"
    await prisma.productVariant.create({
      data: {
        id: genId("m1test_var"),
        productId: prod.product.id,
        size: "Small",
        color: "Navy",
        stock: 5,
      },
    });

    await expect(
      renameCategorySizeAction(cat.id, "S", "Small")
    ).rejects.toThrow(/collision/i);

    // Ensure no partial update occurred on Category.sizes
    const unchangedCat = await prisma.category.findUniqueOrThrow({ where: { id: cat.id } });
    expect(unchangedCat.sizes).toEqual(["S", "M", "L"]);
  });

  it("4. addMissingSizeVariantsAction creates missing combos with stock 0 and is idempotent", async () => {
    mockStaff();

    const cat = await prisma.category.create({
      data: {
        id: genId("m1test_cat"),
        slug: genId("m1test-cat"),
        name: "Missing Combo Category",
        sizes: ["S", "M", "L", "XL"],
      },
    });

    // Product currently only has "S" in Olive and "M" in Black
    const prod = await createTestProduct({
      categoryId: cat.id,
      status: "ACTIVE",
      variants: [
        { size: "S", stock: 10, color: "Olive", colorHex: "#556b2f" },
        { size: "M", stock: 8, color: "Black", colorHex: "#000000" },
      ],
    });

    // Run add-missing for product
    // For Olive: missing M, L, XL (3)
    // For Black: missing S, L, XL (3)
    // Total created: 6
    const res = await addMissingSizeVariantsAction(prod.product.id);
    expect(res.success).toBe(true);
    expect(res.createdCount).toBe(6);

    const variants = await prisma.productVariant.findMany({
      where: { productId: prod.product.id },
    });
    expect(variants.length).toBe(8); // 2 original + 6 new

    // All newly created variants must have stock 0
    const createdOliveM = variants.find((v) => v.color === "Olive" && v.size === "M");
    expect(createdOliveM?.stock).toBe(0);
    expect(createdOliveM?.colorHex).toBe("#556b2f");

    // Idempotency: re-running creates 0 variants
    const res2 = await addMissingSizeVariantsAction(prod.product.id);
    expect(res2.success).toBe(true);
    expect(res2.createdCount).toBe(0);

    const audit = await prisma.auditLog.findFirst({
      where: {
        action: "variant.add_missing_sizes",
        entityId: prod.product.id,
      },
      orderBy: { createdAt: "desc" },
    });
    expect(audit).toBeDefined();
  });
});
