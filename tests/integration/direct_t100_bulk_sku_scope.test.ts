import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { prisma } from "../helpers/prisma";
import { createTestUser, createTestProduct, cleanupM1TestRows } from "../helpers/fixtures";

const mockStaffUser = { id: "", role: "STAFF", name: "Staff Member" };

vi.mock("@/lib/guards", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/guards")>();
  return {
    ...actual,
    requireStaff: vi.fn(async () => mockStaffUser),
  };
});

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { generateMissingSkusAction } from "@/lib/actions/variants";

describe("T100: Bulk SKU Scope Validation & Preview", () => {
  let staffUserId = "";

  beforeAll(async () => {
    const staffUser = await createTestUser({ role: "STAFF" });
    staffUserId = staffUser.id;
    mockStaffUser.id = staffUser.id;
    mockStaffUser.name = staffUser.name;
  });

  afterAll(async () => {
    try {
      if (staffUserId) {
        await prisma.auditLog.deleteMany({ where: { actorId: staffUserId } });
        await prisma.user.deleteMany({ where: { id: staffUserId } });
      }
      await cleanupM1TestRows();
    } catch {
      // ignore cleanup errors
    }
  });

  beforeEach(async () => {
    await cleanupM1TestRows();
  });

  it("throws when scope is product or category without scopeId", async () => {
    await expect(
      generateMissingSkusAction({ scope: "product" })
    ).rejects.toThrow("scopeId required for scope product");

    await expect(
      generateMissingSkusAction({ scope: "category", scopeId: "   " })
    ).rejects.toThrow("scopeId required for scope category");
  });

  it("scope all with preview=true returns candidates without mutating the database", async () => {
    const { variants } = await createTestProduct({
      price: 99900,
      variants: [{ size: "M", color: "Olive", sku: null, stock: 5 }],
    });

    const res = await generateMissingSkusAction({ scope: "all", preview: true });
    expect(res.preview).toBe(true);
    expect(res.assignedCount).toBe(0);
    expect(res.candidates.some((c) => c.variantId === variants[0].id)).toBe(true);

    const dbVar = await prisma.productVariant.findUnique({ where: { id: variants[0].id } });
    expect(dbVar?.sku).toBeNull();
  });
});
