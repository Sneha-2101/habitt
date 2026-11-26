import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma } from "../helpers/prisma";
import { createTestUser, createTestProduct, cleanupM1TestRows } from "../helpers/fixtures";

const mockRequireStaff = vi.fn();

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));
vi.mock("@/lib/guards", () => ({
  requireStaff: () => mockRequireStaff(),
}));

import { updateProduct } from "@/lib/actions/products";

describe("T112: Product Slug Redirects on Rename", () => {
  beforeEach(async () => {
    await cleanupM1TestRows();
  });

  afterEach(async () => {
    await cleanupM1TestRows();
  });

  it("creates ProductSlugRedirect on rename, blocks hijacking another product's old slug, and deletes self-redirect on revert", async () => {
    const staff = await createTestUser({ role: "STAFF" });
    mockRequireStaff.mockResolvedValue(staff);

    const { product: p1 } = await createTestProduct({
      price: 249900,
    });
    const oldSlug = p1.slug;
    const newSlug = `${oldSlug}-v2`;

    const fd1 = new FormData();
    fd1.set("name", p1.name);
    fd1.set("slug", newSlug);
    fd1.set("categoryId", p1.categoryId);
    fd1.set("price", "2499");
    fd1.set("description", "Updated");
    fd1.set("status", "ACTIVE");

    await updateProduct(p1.id, fd1);

    const updated1 = await prisma.product.findUnique({ where: { id: p1.id } });
    expect(updated1?.slug).toBe(newSlug);

    const redirectRow = await prisma.productSlugRedirect.findUnique({
      where: { oldSlug },
    });
    expect(redirectRow?.productId).toBe(p1.id);

    // Second product cannot claim oldSlug
    const { product: p2 } = await createTestProduct({
      categoryId: p1.categoryId,
      price: 199900,
    });
    const fd2 = new FormData();
    fd2.set("name", p2.name);
    fd2.set("slug", oldSlug);
    fd2.set("categoryId", p1.categoryId);
    fd2.set("price", "1999");
    fd2.set("description", "Other");
    fd2.set("status", "ACTIVE");

    await expect(updateProduct(p2.id, fd2)).rejects.toThrow("Slug is an old link of another product.");

    // Reverting p1 back to oldSlug deletes oldSlug redirect and creates newSlug redirect
    const fdRevert = new FormData();
    fdRevert.set("name", p1.name);
    fdRevert.set("slug", oldSlug);
    fdRevert.set("categoryId", p1.categoryId);
    fdRevert.set("price", "2499");
    fdRevert.set("description", "Reverted");
    fdRevert.set("status", "ACTIVE");

    await updateProduct(p1.id, fdRevert);

    expect(await prisma.productSlugRedirect.findUnique({ where: { oldSlug } })).toBeNull();
    const newRedirect = await prisma.productSlugRedirect.findUnique({ where: { oldSlug: newSlug } });
    expect(newRedirect?.productId).toBe(p1.id);
  });
});
