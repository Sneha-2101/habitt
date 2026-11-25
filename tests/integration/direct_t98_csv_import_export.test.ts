import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "../helpers/prisma";
import {
  createTestProduct,
  cleanupM1TestRows,
  genId,
} from "../helpers/fixtures";
import {
  exportProductsCsv,
  parseProductsCsv,
  planImport,
  applyImport,
  STANDARD_HEADERS,
} from "@/lib/admin/csv-products";
import { generateMissingSkusAction } from "@/lib/actions/variants";
import { createTestUser } from "../helpers/fixtures";
import { vi } from "vitest";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

const mockStaff = { id: "", role: "STAFF", name: "Staff Member" };
const mockOwner = { id: "", role: "OWNER", name: "Store Owner" };

vi.mock("@/lib/guards", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/guards")>();
  return {
    ...actual,
    requireStaff: vi.fn(async () => mockOwner),
  };
});

describe("T98: CSV Import/Export & Bulk SKU Automation", () => {
  beforeEach(async () => {
    await cleanupM1TestRows();
    const user = await createTestUser({ role: "OWNER" });
    mockOwner.id = user.id;
    mockStaff.id = user.id;
  });

  afterEach(async () => {
    await cleanupM1TestRows();
  });

  it("exports catalog and round-trip import plan produces UNCHANGED", async () => {
    const { product } = await createTestProduct({
      price: 129900,
      variants: [
        { size: "M", color: "Blue", sku: `SKU-${genId().slice(0, 6)}`, stock: 25 },
      ],
    });

    const csvText = await exportProductsCsv("OWNER");
    expect(csvText).toContain(product.slug);
    expect(csvText).toContain("costPrice");

    const parsed = parseProductsCsv(csvText, "OWNER");
    expect(parsed.errors).toEqual([]);

    const plan = await planImport(parsed.rows, "OWNER");
    const matchedRow = plan.rows.find((r) => r.productSlug === product.slug);
    expect(matchedRow).toBeDefined();
    expect(matchedRow!.action).toBe("UNCHANGED");
  });

  it("stock update in CSV generates StockMovement with reason MANUAL_ADJUST and refType IMPORT", async () => {
    const sku = `SKU-${genId().slice(0, 6)}`;
    const { product, variants } = await createTestProduct({
      price: 150000,
      variants: [
        { size: "L", color: "Black", sku, stock: 10 },
      ],
    });

    const header = STANDARD_HEADERS.join(",");
    const updatedCsv = `${header}\n${product.slug},"${product.name}",Tops,1500,,ACTIVE,,61091000,Cotton,Regular,Black,L,${sku},35`;

    const parsed = parseProductsCsv(updatedCsv, "STAFF");
    const plan = await planImport(parsed.rows, "STAFF");
    const matched = plan.rows.find((r) => r.sku === sku);
    expect(matched).toBeDefined();
    expect(matched!.action).toBe("UPDATE");
    expect(matched!.oldStock).toBe(10);
    expect(matched!.newStock).toBe(35);

    const applyRes = await applyImport(plan, "STAFF", mockStaff.id);
    expect(applyRes.appliedCount).toBe(1);

    const variantAfter = await prisma.productVariant.findUnique({ where: { id: variants[0].id } });
    expect(variantAfter?.stock).toBe(35);

    const movements = await prisma.stockMovement.findMany({
      where: { variantId: variants[0].id },
    });
    const importMovement = movements.find((m) => m.refType === "IMPORT");
    expect(importMovement).toBeDefined();
    expect(importMovement!.reason).toBe("MANUAL_ADJUST");
    expect(importMovement!.delta).toBe(25);

    // Second apply with same CSV plan is a no-op
    const secondPlan = await planImport(parsed.rows, "STAFF");
    const secondMatched = secondPlan.rows.find((r) => r.sku === sku);
    expect(secondMatched!.action).toBe("UNCHANGED");
  });

  it("generateMissingSkusAction creates unique formatted SKUs and is idempotent", async () => {
    const { product, variants } = await createTestProduct({
      price: 99900,
      variants: [
        { size: "S", color: "Red", sku: null, stock: 5 },
        { size: "M", color: "Red", sku: null, stock: 5 },
      ],
    });

    // Preview
    const previewRes = await generateMissingSkusAction({
      scope: "product",
      scopeId: product.id,
      preview: true,
    });
    expect(previewRes.candidates.length).toBe(2);
    expect(previewRes.assignedCount).toBe(0);
    expect(previewRes.candidates[0].proposedSku).toMatch(/^[A-Z0-9]+-[A-Z0-9]+-[A-Z0-9]+/);

    // Apply
    const applyRes = await generateMissingSkusAction({
      scope: "product",
      scopeId: product.id,
      preview: false,
    });
    expect(applyRes.assignedCount).toBe(2);

    const v1 = await prisma.productVariant.findUnique({ where: { id: variants[0].id } });
    const v2 = await prisma.productVariant.findUnique({ where: { id: variants[1].id } });
    expect(v1?.sku).not.toBeNull();
    expect(v2?.sku).not.toBeNull();
    expect(v1?.sku).not.toBe(v2?.sku);

    // Second run is idempotent (0 missing, 0 assigned)
    const idempotentRes = await generateMissingSkusAction({
      scope: "product",
      scopeId: product.id,
      preview: false,
    });
    expect(idempotentRes.totalMissing).toBe(0);
    expect(idempotentRes.assignedCount).toBe(0);
  });
});
