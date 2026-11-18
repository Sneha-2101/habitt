import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from "vitest";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { prisma } from "../helpers/prisma";
import * as guardsModule from "@/lib/guards";
import { ForbiddenError, type GuardUser } from "@/lib/guards";
import { createCategoryAction, updateCategoryAction, deleteCategoryAction } from "@/lib/actions/categories";
import { getPickerCategories } from "@/lib/catalog/categories";
import { createTestUser, createTestProduct, cleanupM1TestRows, genId } from "../helpers/fixtures";

describe("T71: Category Management Actions & Constraints", () => {
  const testCategoryIds: string[] = [];

  beforeAll(async () => {
    await cleanupM1TestRows();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    if (testCategoryIds.length > 0) {
      // Find all products referencing the categories created in this test
      const products = await prisma.product.findMany({
        where: { categoryId: { in: testCategoryIds } },
        select: { id: true },
      });
      const productIds = products.map((p) => p.id);

      if (productIds.length > 0) {
        // Only delete m1test rows
        const m1ProductIds = productIds.filter((id) => id.startsWith("m1test"));
        if (m1ProductIds.length > 0) {
          await prisma.orderItem.deleteMany({
            where: { productId: { in: m1ProductIds } },
          });
          await prisma.cartItem.deleteMany({
            where: { productId: { in: m1ProductIds } },
          });
          await prisma.review.deleteMany({
            where: { productId: { in: m1ProductIds } },
          });
          await prisma.stockNotification.deleteMany({
            where: { productId: { in: m1ProductIds } },
          });
          await prisma.productImage.deleteMany({
            where: { productId: { in: m1ProductIds } },
          });
          await prisma.productVariant.deleteMany({
            where: { productId: { in: m1ProductIds } },
          });
          await prisma.product.deleteMany({
            where: { id: { in: m1ProductIds } },
          });
        }
      }

      await prisma.category.deleteMany({
        where: { id: { in: testCategoryIds } },
      });
    }
    await cleanupM1TestRows();
  });

  function mockStaffUser(user: { id: string; email?: string | null; name?: string | null }) {
    vi.spyOn(guardsModule, "requireStaff").mockResolvedValue({
      id: user.id,
      email: user.email ?? `${user.id}@habitt.test`,
      name: user.name ?? "Staff",
      role: "STAFF",
    } as GuardUser);
  }

  function mockCustomerUser(user: { id: string; email?: string | null; name?: string | null }) {
    void user;
    vi.spyOn(guardsModule, "requireStaff").mockRejectedValue(new ForbiddenError());
  }

  it("1. CUSTOMER cannot call any action (rejected with ForbiddenError/UnauthorizedError)", async () => {
    const customer = await createTestUser({ email: `${genId("m1test_cust")}@habitt.test` });
    mockCustomerUser(customer);

    await expect(
      createCategoryAction({
        slug: "m1test-customer-cat",
        name: "Customer Cat",
        sizes: ["S", "M"],
      })
    ).rejects.toThrow();

    await expect(
      updateCategoryAction("cat_shirts", {
        name: "Hacked",
        sizes: ["S"],
        position: 0,
        active: true,
      })
    ).rejects.toThrow();

    await expect(
      deleteCategoryAction("cat_shirts")
    ).rejects.toThrow();
  });

  it("2. Staff can create category; writes AuditLog row", async () => {
    const staff = await createTestUser({ email: `${genId("m1test_staff")}@habitt.test`, role: "STAFF" });
    mockStaffUser(staff);

    const slug = `m1test-cat-${genId("slug")}`.replace(/_/g, "-");
    const res = await createCategoryAction({
      slug,
      name: "Test Linens",
      sizes: ["S", "M", "L"],
      position: 4,
      active: true,
    });

    expect(res.success).toBe(true);
    expect(res.category).toBeDefined();
    testCategoryIds.push(res.category.id);

    const dbCat = await prisma.category.findUnique({ where: { slug } });
    expect(dbCat).not.toBeNull();
    expect(dbCat?.name).toBe("Test Linens");
    expect(dbCat?.sizes).toEqual(["S", "M", "L"]);

    // Verify audit log
    const audit = await prisma.auditLog.findFirst({
      where: {
        action: "category.create",
        entityId: res.category.id,
      },
    });
    expect(audit).not.toBeNull();
    expect(audit?.actorId).toBe(staff.id);
  });

  it("3. Duplicate slug rejected", async () => {
    const staff = await createTestUser({ email: `${genId("m1test_staff")}@habitt.test`, role: "STAFF" });
    mockStaffUser(staff);

    const slug = `m1test-dup-${genId("slug")}`.replace(/_/g, "-");
    const first = await createCategoryAction({
      slug,
      name: "Duplicate One",
      sizes: ["S", "M"],
    });
    testCategoryIds.push(first.category.id);

    await expect(
      createCategoryAction({
        slug,
        name: "Duplicate Two",
        sizes: ["L", "XL"],
      })
    ).rejects.toThrow(/duplicate/i);
  });

  it("4. Update sizes OK; writes AuditLog row", async () => {
    const staff = await createTestUser({ email: `${genId("m1test_staff")}@habitt.test`, role: "STAFF" });
    mockStaffUser(staff);

    const slug = `m1test-upd-${genId("slug")}`.replace(/_/g, "-");
    const cat = await createCategoryAction({
      slug,
      name: "Original Name",
      sizes: ["S", "M"],
      position: 1,
      active: true,
    });
    testCategoryIds.push(cat.category.id);

    const updateRes = await updateCategoryAction(cat.category.id, {
      name: "Updated Name",
      sizes: ["S", "M", "L", "XL"],
      position: 2,
      active: false,
    });

    expect(updateRes.success).toBe(true);
    expect(updateRes.category.name).toBe("Updated Name");
    expect(updateRes.category.sizes).toEqual(["S", "M", "L", "XL"]);
    expect(updateRes.category.active).toBe(false);

    // Verify audit log
    const audit = await prisma.auditLog.findFirst({
      where: {
        action: "category.update",
        entityId: cat.category.id,
      },
      orderBy: { createdAt: "desc" },
    });
    expect(audit).not.toBeNull();
    expect(audit?.actorId).toBe(staff.id);
  });

  it("5. Removing a size that a variant uses is rejected; removing an unused size works", async () => {
    const staff = await createTestUser({ email: `${genId("m1test_staff")}@habitt.test`, role: "STAFF" });
    mockStaffUser(staff);

    const slug = `m1test-sz-${genId("slug")}`.replace(/_/g, "-");
    const catRes = await createCategoryAction({
      slug,
      name: "Size Guard Test",
      sizes: ["S", "M", "L"],
    });
    const catId = catRes.category.id;
    testCategoryIds.push(catId);

    // Create a product referencing this category with variant size M
    await createTestProduct({
      categoryId: catId,
      variants: [{ size: "M", stock: 10 }],
    });

    // Attempt to remove "M" from sizes (only keep "S" and "L") -> must reject
    await expect(
      updateCategoryAction(catId, {
        name: "Size Guard Test",
        sizes: ["S", "L"],
        position: 0,
        active: true,
      })
    ).rejects.toThrow(/currently used by product/i);

    // Removing an unused size "L" (keep "S" and "M") -> works!
    const okRes = await updateCategoryAction(catId, {
      name: "Size Guard Test",
      sizes: ["S", "M"],
      position: 0,
      active: true,
    });
    expect(okRes.success).toBe(true);
    expect(okRes.category.sizes).toEqual(["S", "M"]);
  });

  it("6. Delete rejected while a product exists; works when empty; writes AuditLog row", async () => {
    const staff = await createTestUser({ email: `${genId("m1test_staff")}@habitt.test`, role: "STAFF" });
    mockStaffUser(staff);

    const slug = `m1test-del-${genId("slug")}`.replace(/_/g, "-");
    const catRes = await createCategoryAction({
      slug,
      name: "Delete Test",
      sizes: ["S", "M"],
    });
    const catId = catRes.category.id;
    testCategoryIds.push(catId);

    // Create product referencing this category
    const { product } = await createTestProduct({
      categoryId: catId,
      variants: [{ size: "M", stock: 5 }],
    });

    // Delete should fail
    await expect(deleteCategoryAction(catId)).rejects.toThrow(/reference it/i);

    // Delete the product and its variants so category is now empty
    await prisma.productVariant.deleteMany({ where: { productId: product.id } });
    await prisma.product.delete({ where: { id: product.id } });

    // Now delete succeeds
    const delRes = await deleteCategoryAction(catId);
    expect(delRes.success).toBe(true);

    const dbCheck = await prisma.category.findUnique({ where: { id: catId } });
    expect(dbCheck).toBeNull();

    // Verify audit log
    const audit = await prisma.auditLog.findFirst({
      where: {
        action: "category.delete",
        entityId: catId,
      },
    });
    expect(audit).not.toBeNull();
  });

  it("7. Inactive category is excluded by getPickerCategories()", async () => {
    const staff = await createTestUser({ email: `${genId("m1test_staff")}@habitt.test`, role: "STAFF" });
    mockStaffUser(staff);

    const slugActive = `m1test-act-${genId("slug")}`.replace(/_/g, "-");
    const slugInactive = `m1test-inact-${genId("slug")}`.replace(/_/g, "-");

    const cat1 = await createCategoryAction({
      slug: slugActive,
      name: "Active Category",
      sizes: ["S"],
      active: true,
    });
    const cat2 = await createCategoryAction({
      slug: slugInactive,
      name: "Inactive Category",
      sizes: ["S"],
      active: false,
    });
    testCategoryIds.push(cat1.category.id, cat2.category.id);

    const pickerCats = await getPickerCategories();
    const slugs = pickerCats.map((c) => c.slug);

    expect(slugs).toContain(slugActive);
    expect(slugs).not.toContain(slugInactive);
  });
});
