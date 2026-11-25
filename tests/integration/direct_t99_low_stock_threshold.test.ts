import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { prisma } from "../helpers/prisma";
import { createTestProduct, cleanupM1TestRows } from "../helpers/fixtures";
import { stockReport } from "@/lib/admin/reports";
import { SiteSettings } from "@prisma/client";

describe("T99: Low Stock Threshold Dynamic Calculation", () => {
  let originalSettings: SiteSettings | null = null;

  beforeAll(async () => {
    originalSettings = await prisma.siteSettings.findUnique({ where: { id: "default" } });
  });

  afterAll(async () => {
    try {
      await cleanupM1TestRows();
    } finally {
      if (originalSettings) {
        const { id, ...data } = originalSettings;
        await prisma.siteSettings.update({
          where: { id },
          data,
        });
      }
    }
  });

  beforeEach(async () => {
    await cleanupM1TestRows();
  });

  afterEach(async () => {
    await cleanupM1TestRows();
  });

  it("evaluates isLowStock dynamically against SiteSettings.lowStockThreshold", async () => {
    const { variants } = await createTestProduct({
      price: 100000,
      variants: [
        { size: "S", stock: 3 },
        { size: "M", stock: 8 },
        { size: "L", stock: 15 },
      ],
    });

    const vS = variants.find((v) => v.size === "S")!;
    const vM = variants.find((v) => v.size === "M")!;
    const vL = variants.find((v) => v.size === "L")!;

    // 1. Set threshold = 5
    await prisma.siteSettings.upsert({
      where: { id: "default" },
      update: { lowStockThreshold: 5 },
      create: { id: "default", lowStockThreshold: 5 },
    });

    const reportThreshold5 = await stockReport("STAFF");
    expect(reportThreshold5.lowStockThreshold).toBe(5);

    const itemS5 = reportThreshold5.variants.find((v) => v.variantId === vS.id);
    const itemM5 = reportThreshold5.variants.find((v) => v.variantId === vM.id);
    const itemL5 = reportThreshold5.variants.find((v) => v.variantId === vL.id);

    expect(itemS5?.isLowStock).toBe(true);  // 3 <= 5
    expect(itemM5?.isLowStock).toBe(false); // 8 > 5
    expect(itemL5?.isLowStock).toBe(false); // 15 > 5

    // 2. Set threshold = 10
    await prisma.siteSettings.update({
      where: { id: "default" },
      data: { lowStockThreshold: 10 },
    });

    const reportThreshold10 = await stockReport("STAFF");
    expect(reportThreshold10.lowStockThreshold).toBe(10);

    const itemS10 = reportThreshold10.variants.find((v) => v.variantId === vS.id);
    const itemM10 = reportThreshold10.variants.find((v) => v.variantId === vM.id);
    const itemL10 = reportThreshold10.variants.find((v) => v.variantId === vL.id);

    expect(itemS10?.isLowStock).toBe(true); // 3 <= 10
    expect(itemM10?.isLowStock).toBe(true); // 8 <= 10
    expect(itemL10?.isLowStock).toBe(false); // 15 > 10
  });
});
