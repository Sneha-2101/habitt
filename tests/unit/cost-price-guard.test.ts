import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * EXPLICIT WHITELIST:
 * The string `costPrice` may appear ONLY in the following sanctioned locations:
 * 1. lib/actions/products.ts
 * 2. lib/catalog/product-fields.ts
 * 3. lib/prisma.ts
 * 4. app/admin/products/**
 */
const COST_PRICE_WHITELIST = [
  "lib/actions/products.ts",
  "lib/catalog/product-fields.ts",
  "lib/prisma.ts",
  "lib/offers/load.ts",
  "app/admin/products/",
  "lib/admin/reports.ts",
  "lib/admin/csv-products.ts",
  "app/api/admin/reports/",
  "app/admin/reports/",
];

function isWhitelisted(normalizedRelPath: string): boolean {
  return COST_PRICE_WHITELIST.some((allowed) => {
    if (allowed.endsWith("/")) {
      return normalizedRelPath.startsWith(allowed);
    }
    return normalizedRelPath === allowed;
  });
}

function scanDirectory(dir: string, baseDir: string, violations: string[]) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(baseDir, fullPath).replace(/\\/g, "/");

    if (entry.isDirectory()) {
      scanDirectory(fullPath, baseDir, violations);
    } else if (entry.isFile() && /\.(ts|tsx|js|jsx)$/.test(entry.name)) {
      if (!isWhitelisted(relPath)) {
        const content = fs.readFileSync(fullPath, "utf8");
        const lines = content.split("\n");
        lines.forEach((line, index) => {
          if (line.includes("costPrice")) {
            violations.push(`${relPath}:${index + 1}: ${line.trim()}`);
          }
        });
      }
    }
  }
}

describe("cost-price-guard", () => {
  it("ensures costPrice appears ONLY in the explicit whitelist and never leaks to storefront or client", () => {
    const baseDir = process.cwd();
    const directoriesToScan = ["app", "components", "lib"];
    const violations: string[] = [];

    for (const dirName of directoriesToScan) {
      const fullDir = path.join(baseDir, dirName);
      if (fs.existsSync(fullDir)) {
        scanDirectory(fullDir, baseDir, violations);
      }
    }

    if (violations.length > 0) {
      console.error("Disallowed costPrice occurrences found:\n" + violations.join("\n"));
    }

    expect(violations).toEqual([]);
  });
});
