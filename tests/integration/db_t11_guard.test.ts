import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "../helpers/prisma";
import { createTestProduct, cleanupM1TestRows } from "../helpers/fixtures";

describe("T11: Database Non-Negative Stock Check Constraint", () => {
  beforeEach(async () => {
    await cleanupM1TestRows();
  });

  afterEach(async () => {
    await cleanupM1TestRows();
  });

  it("T11 DB guard: raw UPDATE setting stock = -1 is rejected by Postgres CHECK constraint", async () => {
    const { variants } = await createTestProduct({ price: 100000, variants: [{ size: "M", stock: 5 }] });
    const variant = variants[0];

    // Attempting raw UPDATE with stock = -1 must throw from Postgres
    let threw = false;
    let errorCode: string | undefined;
    let errorMessage: string | undefined;

    try {
      await prisma.$executeRawUnsafe(
        `UPDATE "ProductVariant" SET stock = -1 WHERE id = $1`,
        variant.id
      );
    } catch (err: any) {
      threw = true;
      errorCode = err.code;
      errorMessage = err.message;
    }

    expect(threw).toBe(true);
    // Postgres error 23514 is check_violation
    expect(errorMessage).toContain("ProductVariant_stock_nonnegative");

    // Stock in database remains untouched (still 5)
    const after = await prisma.productVariant.findUnique({ where: { id: variant.id } });
    expect(after?.stock).toBe(5);
  });
});
