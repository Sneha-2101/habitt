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
import { type GuardUser } from "@/lib/guards";
import { createProduct, updateProduct } from "@/lib/actions/products";
import { createTestUser, cleanupM1TestRows, genId } from "../helpers/fixtures";

describe("T72: Product Merchandising Fields & Cost Price Guard", () => {
  const createdProductIds: string[] = [];
  const testUserIds: string[] = [];

  beforeAll(async () => {
    await cleanupM1TestRows();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    if (createdProductIds.length > 0) {
      const m1ProductIds = createdProductIds.filter((id) => id.startsWith("m1test"));
      if (m1ProductIds.length > 0) {
        await prisma.orderItem.deleteMany({ where: { productId: { in: m1ProductIds } } });
        await prisma.cartItem.deleteMany({ where: { productId: { in: m1ProductIds } } });
        await prisma.review.deleteMany({ where: { productId: { in: m1ProductIds } } });
        await prisma.stockNotification.deleteMany({ where: { productId: { in: m1ProductIds } } });
        await prisma.productImage.deleteMany({ where: { productId: { in: m1ProductIds } } });
        await prisma.productVariant.deleteMany({ where: { productId: { in: m1ProductIds } } });
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

  function mockOwnerUser(user: { id: string; email?: string | null; name?: string | null }) {
    vi.spyOn(guardsModule, "requireStaff").mockResolvedValue({
      id: user.id,
      email: user.email ?? `${user.id}@habitt.test`,
      name: user.name ?? "Owner User",
      role: "OWNER",
    } as GuardUser);
  }

  it("1. STAFF creates a product with merchandising fields (stored; cost ignored and still null)", async () => {
    const staff = await createTestUser({ email: `${genId("m1test_staff")}@habitt.test` });
    testUserIds.push(staff.id);
    mockStaffUser(staff);

    const formData = new FormData();
    const productName = `m1test Staff Shirt ${genId()}`;
    formData.set("name", productName);
    formData.set("categoryId", "cat_shirts");
    formData.set("price", "1200");
    formData.set("stock", "5");
    formData.set("description", "A finely crafted shirt");
    formData.set("compareAtRupees", "1800");
    formData.set("costRupees", "600"); // STAFF sets cost — MUST be ignored!
    formData.set("hsn", "6205");
    formData.set("fabric", "100% Linen");
    formData.set("fit", "Relaxed");
    formData.set("care", "Machine wash cold");
    formData.set("sizeChartUrl", "https://example.com/charts/shirts");
    formData.set("seoTitle", "SEO Linen Shirt");
    formData.set("seoDescription", "SEO description for linen shirt");

    await createProduct(formData);

    const created = await prisma.product.findFirst({
      where: { name: productName },
      omit: { costPrice: false },
    });

    expect(created).not.toBeNull();
    createdProductIds.push(created!.id);

    expect(created!.price).toBe(120000);
    expect(created!.compareAtPrice).toBe(180000);
    expect(created!.costPrice).toBeNull(); // Cost was ignored!
    expect(created!.hsn).toBe("6205");
    expect(created!.fabric).toBe("100% Linen");
    expect(created!.fit).toBe("Relaxed");
    expect(created!.care).toBe("Machine wash cold");
    expect(created!.sizeChartUrl).toBe("https://example.com/charts/shirts");
    expect(created!.seoTitle).toBe("SEO Linen Shirt");
    expect(created!.seoDescription).toBe("SEO description for linen shirt");
  });

  it("2. OWNER creates/updates with a cost (stored)", async () => {
    const owner = await createTestUser({ email: `${genId("m1test_owner")}@habitt.test` });
    testUserIds.push(owner.id);
    mockOwnerUser(owner);

    const formData = new FormData();
    const productName = `m1test Owner Shirt ${genId()}`;
    formData.set("name", productName);
    formData.set("categoryId", "cat_shirts");
    formData.set("price", "1500");
    formData.set("stock", "10");
    formData.set("compareAtRupees", "2200");
    formData.set("costRupees", "850"); // OWNER sets cost — MUST be stored!
    formData.set("hsn", "6205");

    await createProduct(formData);

    const created = await prisma.product.findFirst({
      where: { name: productName },
      omit: { costPrice: false },
    });

    expect(created).not.toBeNull();
    createdProductIds.push(created!.id);
    expect(created!.costPrice).toBe(85000);
    expect(created!.compareAtPrice).toBe(220000);

    // OWNER updates cost
    const updateForm = new FormData();
    updateForm.set("name", productName);
    updateForm.set("categoryId", "cat_shirts");
    updateForm.set("price", "1500");
    updateForm.set("status", "ACTIVE");
    updateForm.set("compareAtRupees", "2200");
    updateForm.set("costRupees", "900"); // Updated cost

    await updateProduct(created!.id, updateForm);

    const updated = await prisma.product.findUnique({
      where: { id: created!.id },
      omit: { costPrice: false },
    });
    expect(updated?.costPrice).toBe(90000);
  });

  it("3. STAFF update does not change or clear an existing cost", async () => {
    const owner = await createTestUser({ email: `${genId("m1test_owner2")}@habitt.test` });
    const staff = await createTestUser({ email: `${genId("m1test_staff2")}@habitt.test` });
    testUserIds.push(owner.id, staff.id);

    // Create product as OWNER with cost 95000
    mockOwnerUser(owner);
    const formData = new FormData();
    const productName = `m1test Staff Tamper Test ${genId()}`;
    formData.set("name", productName);
    formData.set("categoryId", "cat_shirts");
    formData.set("price", "2000");
    formData.set("stock", "5");
    formData.set("costRupees", "950");

    await createProduct(formData);
    const product = await prisma.product.findFirst({
      where: { name: productName },
      omit: { costPrice: false },
    });
    expect(product).not.toBeNull();
    createdProductIds.push(product!.id);
    expect(product!.costPrice).toBe(95000);

    // STAFF updates the product and attempts to post costRupees: "200"
    mockStaffUser(staff);
    const staffUpdateForm = new FormData();
    staffUpdateForm.set("name", `${productName} (Edited by Staff)`);
    staffUpdateForm.set("categoryId", "cat_shirts");
    staffUpdateForm.set("price", "2000");
    staffUpdateForm.set("status", "ACTIVE");
    staffUpdateForm.set("costRupees", "200"); // Attempted tamper

    await updateProduct(product!.id, staffUpdateForm);

    // Verify costPrice is STILL 95000
    const afterStaffUpdate = await prisma.product.findUnique({
      where: { id: product!.id },
      omit: { costPrice: false },
    });
    expect(afterStaffUpdate?.costPrice).toBe(95000);
    expect(afterStaffUpdate?.name).toBe(`${productName} (Edited by Staff)`);
  });

  it("4. compareAt <= price rejected", async () => {
    const staff = await createTestUser({ email: `${genId("m1test_staff3")}@habitt.test` });
    testUserIds.push(staff.id);
    mockStaffUser(staff);

    const formDataEqual = new FormData();
    formDataEqual.set("name", `m1test Equal ${genId()}`);
    formDataEqual.set("categoryId", "cat_shirts");
    formDataEqual.set("price", "1000");
    formDataEqual.set("compareAtRupees", "1000");

    await expect(createProduct(formDataEqual)).rejects.toThrow(
      /Compare-at price must be greater than/i
    );

    const formDataLesser = new FormData();
    formDataLesser.set("name", `m1test Lesser ${genId()}`);
    formDataLesser.set("categoryId", "cat_shirts");
    formDataLesser.set("price", "1000");
    formDataLesser.set("compareAtRupees", "800");

    await expect(createProduct(formDataLesser)).rejects.toThrow(
      /Compare-at price must be greater than/i
    );
  });

  it("5. price raised above or equal to compareAt rejected", async () => {
    const staff = await createTestUser({ email: `${genId("m1test_staff4")}@habitt.test` });
    testUserIds.push(staff.id);
    mockStaffUser(staff);

    // Create with price 1000, compareAt 1500
    const formData = new FormData();
    const productName = `m1test Raise Price Test ${genId()}`;
    formData.set("name", productName);
    formData.set("categoryId", "cat_shirts");
    formData.set("price", "1000");
    formData.set("compareAtRupees", "1500");

    await createProduct(formData);
    const product = await prisma.product.findFirst({ where: { name: productName } });
    expect(product).not.toBeNull();
    createdProductIds.push(product!.id);

    // Raise price to 1500 (equal to compareAt)
    const updateEqual = new FormData();
    updateEqual.set("name", productName);
    updateEqual.set("categoryId", "cat_shirts");
    updateEqual.set("price", "1500");
    updateEqual.set("status", "DRAFT");

    await expect(updateProduct(product!.id, updateEqual)).rejects.toThrow(
      /Price cannot be greater than or equal to compare-at price/i
    );

    // Raise price to 1600 (greater than compareAt)
    const updateGreater = new FormData();
    updateGreater.set("name", productName);
    updateGreater.set("categoryId", "cat_shirts");
    updateGreater.set("price", "1600");
    updateGreater.set("status", "DRAFT");

    await expect(updateProduct(product!.id, updateGreater)).rejects.toThrow(
      /Price cannot be greater than or equal to compare-at price/i
    );
  });

  it("6. bad HSN rejected", async () => {
    const staff = await createTestUser({ email: `${genId("m1test_staff5")}@habitt.test` });
    testUserIds.push(staff.id);
    mockStaffUser(staff);

    const formDataBadHsn = new FormData();
    formDataBadHsn.set("name", `m1test Bad HSN ${genId()}`);
    formDataBadHsn.set("categoryId", "cat_shirts");
    formDataBadHsn.set("price", "1000");
    formDataBadHsn.set("hsn", "123"); // 3 digits, invalid

    await expect(createProduct(formDataBadHsn)).rejects.toThrow(/HSN code must be 4, 6, or 8 digits/i);
  });

  it("7. default prisma.product.findFirst has no costPrice key while omit: { costPrice: false } has it", async () => {
    const owner = await createTestUser({ email: `${genId("m1test_owner3")}@habitt.test` });
    testUserIds.push(owner.id);
    mockOwnerUser(owner);

    const formData = new FormData();
    const productName = `m1test Omit Check ${genId()}`;
    formData.set("name", productName);
    formData.set("categoryId", "cat_shirts");
    formData.set("price", "1000");
    formData.set("costRupees", "400");

    await createProduct(formData);
    const created = await prisma.product.findFirst({
      where: { name: productName },
      omit: { costPrice: false },
    });
    expect(created).not.toBeNull();
    createdProductIds.push(created!.id);

    // Default read
    const defaultRead = await prisma.product.findFirst({
      where: { id: created!.id },
    });
    expect(defaultRead).not.toBeNull();
    expect("costPrice" in defaultRead!).toBe(false);

    // Opt-in read
    const optInRead = await prisma.product.findFirst({
      where: { id: created!.id },
      omit: { costPrice: false },
    });
    expect(optInRead).not.toBeNull();
    expect("costPrice" in optInRead!).toBe(true);
    expect(optInRead!.costPrice).toBe(40000);
  });

  it("8. AuditLog meta of a STAFF change contains no costPrice", async () => {
    const staff = await createTestUser({ email: `${genId("m1test_staff6")}@habitt.test` });
    testUserIds.push(staff.id);
    mockStaffUser(staff);

    const formData = new FormData();
    const productName = `m1test Audit Staff ${genId()}`;
    formData.set("name", productName);
    formData.set("categoryId", "cat_shirts");
    formData.set("price", "1000");
    formData.set("compareAtRupees", "1400");
    formData.set("costRupees", "500"); // Ignored

    await createProduct(formData);
    const product = await prisma.product.findFirst({ where: { name: productName } });
    expect(product).not.toBeNull();
    createdProductIds.push(product!.id);

    const auditLog = await prisma.auditLog.findFirst({
      where: {
        entityId: product!.id,
        action: "product.create",
      },
      orderBy: { createdAt: "desc" },
    });

    expect(auditLog).not.toBeNull();
    const meta = auditLog!.meta as { after?: Record<string, unknown> } | null;
    expect(meta?.after).toBeDefined();
    expect("costPrice" in (meta?.after ?? {})).toBe(false);
  });
});
