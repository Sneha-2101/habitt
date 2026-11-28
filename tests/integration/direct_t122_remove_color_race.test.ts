import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma } from "../helpers/prisma";
import {
  cleanupM1TestRows,
  createTestProduct,
  createTestUser,
  genId,
} from "../helpers/fixtures";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

const mockRequireStaff = vi.fn();
vi.mock("@/lib/guards", () => ({
  requireStaff: () => mockRequireStaff(),
}));

import { removeColorAction } from "@/lib/actions/variants";

describe("T122: removeColorAction concurrency race", () => {
  beforeEach(async () => {
    await cleanupM1TestRows();
  });

  afterEach(async () => {
    await cleanupM1TestRows();
  });

  it("serializes parallel removeColorAction calls so at least one color remains", async () => {
    const staff = await createTestUser({
      id: genId("m1test_staff_rc"),
      email: `${genId("m1test_staff_rc")}@example.test`,
      role: "STAFF",
    });
    mockRequireStaff.mockResolvedValue({ id: staff.id, role: "STAFF" });

    const { product } = await createTestProduct({
      variants: [
        { size: "M", color: "Red", colorHex: "#ff0000", stock: 5 },
        { size: "M", color: "Blue", colorHex: "#0000ff", stock: 5 },
      ],
    });

    const results = await Promise.allSettled([
      removeColorAction(product.id, "Red"),
      removeColorAction(product.id, "Blue"),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const remainingVariants = await prisma.productVariant.findMany({
      where: { productId: product.id },
    });
    expect(remainingVariants.length).toBeGreaterThanOrEqual(1);
  });
});
