import { prisma } from "@/lib/prisma";
import { sanitizeCsvCell } from "@/lib/csv";
import { z } from "zod";
import { ProductStatus, Prisma } from "@prisma/client";

export const MAX_CSV_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB
export const MAX_CSV_ROWS = 5000;

export const STANDARD_HEADERS = [
  "productSlug",
  "name",
  "category",
  "price",
  "compareAtPrice",
  "status",
  "publishAt",
  "hsn",
  "fabric",
  "fit",
  "color",
  "size",
  "sku",
  "stock",
] as const;

export const OWNER_HEADERS = [...STANDARD_HEADERS, "costPrice"] as const;

export interface ProductCsvRow {
  rowNumber: number;
  productSlug: string;
  name: string;
  category: string;
  price: number; // in rupees
  compareAtPrice: number | null; // in rupees
  status: ProductStatus;
  publishAt: Date | null;
  hsn: string | null;
  fabric: string | null;
  fit: string | null;
  color: string;
  size: string;
  sku: string | null;
  stock: number;
  costPrice: number | null; // in rupees, OWNER only
}

export interface ParseProductsCsvResult {
  hasCostPriceColumn: boolean;
  rows: ProductCsvRow[];
  errors: Array<{ rowNumber: number; message: string }>;
}

export type PlannedAction = "CREATE" | "UPDATE" | "UNCHANGED" | "ERROR";

export interface PlannedRow {
  rowNumber: number;
  action: PlannedAction;
  productSlug: string;
  name: string;
  color: string;
  size: string;
  sku: string | null;
  oldStock?: number;
  newStock?: number;
  changes?: Record<string, { before: unknown; after: unknown }>;
  error?: string;
  data: ProductCsvRow;
}

export interface ImportPlan {
  totalRows: number;
  createCount: number;
  updateCount: number;
  unchangedCount: number;
  errorCount: number;
  hasCostPrice: boolean;
  rows: PlannedRow[];
}

export interface ImportApplyResult {
  appliedCount: number;
  skippedCount: number;
  errorCount: number;
  createdProducts: number;
  createdVariants: number;
  updatedVariants: number;
  errors: Array<{ rowNumber: number; error: string }>;
}

/**
 * Export all products & variants as CSV.
 * Cost price column included ONLY if actorRole is OWNER.
 */
export async function exportProductsCsv(actorRole?: string): Promise<string> {
  const isOwner = actorRole === "OWNER";
  const headers = isOwner ? OWNER_HEADERS : STANDARD_HEADERS;

  const products = await prisma.product.findMany({
    include: {
      category: true,
      variants: {
        orderBy: [{ color: "asc" }, { size: "asc" }],
      },
    },
    omit: { costPrice: false },
    orderBy: [{ name: "asc" }],
  });

  const lines: string[] = [headers.map(sanitizeCsvCell).join(",")];

  for (const p of products) {
    const categoryName = p.category?.name || p.category?.slug || "";
    const priceStr = (p.price / 100).toFixed(2);
    const compareAtStr = p.compareAtPrice !== null && p.compareAtPrice !== undefined ? (p.compareAtPrice / 100).toFixed(2) : "";
    const publishAtStr = p.publishAt ? p.publishAt.toISOString() : "";
    const costPriceStr = isOwner && p.costPrice !== null && p.costPrice !== undefined ? (p.costPrice / 100).toFixed(2) : "";

    for (const v of p.variants) {
      const cells = [
        sanitizeCsvCell(p.slug),
        sanitizeCsvCell(p.name),
        sanitizeCsvCell(categoryName),
        sanitizeCsvCell(priceStr),
        sanitizeCsvCell(compareAtStr),
        sanitizeCsvCell(p.status),
        sanitizeCsvCell(publishAtStr),
        sanitizeCsvCell(p.hsn || ""),
        sanitizeCsvCell(p.fabric || ""),
        sanitizeCsvCell(p.fit || ""),
        sanitizeCsvCell(v.color || ""),
        sanitizeCsvCell(v.size),
        sanitizeCsvCell(v.sku || ""),
        sanitizeCsvCell(v.stock),
      ];
      if (isOwner) {
        cells.push(sanitizeCsvCell(costPriceStr));
      }
      lines.push(cells.join(","));
    }
  }

  return lines.join("\n");
}

/**
 * Full-text RFC-4180 style CSV tokenizer returning records (string[][]).
 * Handles quoted commas, escaped quotes (""), embedded LF/CRLF newlines inside quotes,
 * CRLF/LF record ends, trailing newlines, and skips fully blank records.
 * Throws on unterminated quotes.
 */
function tokenizeCsv(text: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let cur = "";
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        if (i + 1 < text.length && text[i + 1] === '"') {
          cur += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
      } else {
        cur += c;
        i++;
      }
    } else {
      if (c === '"' && cur.trim().length === 0) {
        cur = "";
        inQuotes = true;
        i++;
      } else if (c === ",") {
        record.push(cur);
        cur = "";
        i++;
      } else if (c === "\r" || c === "\n") {
        if (c === "\r" && i + 1 < text.length && text[i + 1] === "\n") {
          i += 2;
        } else {
          i++;
        }
        record.push(cur);
        cur = "";
        if (record.some((cell) => cell.trim() !== "")) {
          records.push(record);
        }
        record = [];
      } else {
        cur += c;
        i++;
      }
    }
  }

  if (inQuotes) {
    throw new Error("Unterminated quoted field in CSV");
  }

  if (cur.length > 0 || record.length > 0) {
    record.push(cur);
    if (record.some((cell) => cell.trim() !== "")) {
      records.push(record);
    }
  }

  return records;
}

function cleanCsvCell(rawCell: string): string {
  let val = rawCell.trim();
  if (val.startsWith("'") && /^[=+\-@\t\r]/.test(val.slice(1))) {
    val = val.slice(1);
  }
  return val;
}

const rowZodSchema = z.object({
  productSlug: z.string().min(1, "Product slug is required").regex(/^[a-z0-9-]+$/i, "Invalid slug format"),
  name: z.string().min(1, "Product name is required"),
  category: z.string().min(1, "Category is required"),
  price: z.number().positive("Price must be greater than 0"),
  compareAtPrice: z.number().positive().nullable(),
  status: z.nativeEnum(ProductStatus, { errorMap: () => ({ message: "Status must be DRAFT, ACTIVE, or ARCHIVED" }) }),
  publishAt: z.date().nullable(),
  hsn: z.string().nullable(),
  fabric: z.string().nullable(),
  fit: z.string().nullable(),
  color: z.string(),
  size: z.string().min(1, "Size is required"),
  sku: z.string().nullable(),
  stock: z.number().int("Stock must be an integer").min(0, "Stock cannot be negative"),
  costPrice: z.number().nonnegative("Cost price cannot be negative").nullable(),
}).refine(
  (data) => {
    if (data.compareAtPrice !== null && data.compareAtPrice !== undefined) {
      return data.compareAtPrice > data.price;
    }
    return true;
  },
  {
    message: "compareAtPrice must be greater than price",
    path: ["compareAtPrice"],
  }
);

/**
 * Parses and validates product CSV text.
 * Strictly verifies headers, respects max 2MB and 5000 rows limits, tolerates UTF-8 BOM.
 */
export function parseProductsCsv(text: string, actorRole?: string): ParseProductsCsvResult {
  let raw = text;
  // Tolerate UTF-8 BOM
  if (raw.charCodeAt(0) === 0xFEFF) {
    raw = raw.slice(1);
  }

  const byteLength = Buffer.byteLength(raw, "utf8");
  if (byteLength > MAX_CSV_SIZE_BYTES) {
    throw new Error(`CSV file exceeds maximum size of 2 MB (size: ${(byteLength / (1024 * 1024)).toFixed(2)} MB)`);
  }

  const records = tokenizeCsv(raw);
  if (records.length === 0) {
    throw new Error("CSV file is empty");
  }

  if (records.length - 1 > MAX_CSV_ROWS) {
    throw new Error(`CSV file exceeds maximum of ${MAX_CSV_ROWS} data rows (found: ${records.length - 1})`);
  }

  // Header check
  const headerCells = records[0].map((h) => h.trim());
  const isOwnerHeader =
    headerCells.length === OWNER_HEADERS.length &&
    OWNER_HEADERS.every((col, i) => headerCells[i] === col);
  const isStandardHeader =
    headerCells.length === STANDARD_HEADERS.length &&
    STANDARD_HEADERS.every((col, i) => headerCells[i] === col);

  if (!isOwnerHeader && !isStandardHeader) {
    throw new Error(
      `Invalid CSV headers. Expected:\n${STANDARD_HEADERS.join(",")}\n(or with optional costPrice)`
    );
  }

  const hasCostPriceColumn = isOwnerHeader;
  const rows: ProductCsvRow[] = [];
  const errors: Array<{ rowNumber: number; message: string }> = [];

  for (let i = 1; i < records.length; i++) {
    const rowNumber = i + 1;
    const cells = records[i].map(cleanCsvCell);

    if (cells.length < (hasCostPriceColumn ? OWNER_HEADERS.length : STANDARD_HEADERS.length)) {
      errors.push({
        rowNumber,
        message: `Too few columns (expected ${hasCostPriceColumn ? OWNER_HEADERS.length : STANDARD_HEADERS.length}, got ${cells.length})`,
      });
      continue;
    }

    const [
      productSlug,
      name,
      category,
      priceRaw,
      compareAtRaw,
      statusRaw,
      publishAtRaw,
      hsnRaw,
      fabricRaw,
      fitRaw,
      colorRaw,
      sizeRaw,
      skuRaw,
      stockRaw,
    ] = cells;

    const isOwner = actorRole === "OWNER";
    const costPriceRaw = hasCostPriceColumn && isOwner ? cells[STANDARD_HEADERS.length] : "";

    const priceNum = Number(priceRaw);
    const compareAtNum = compareAtRaw !== "" ? Number(compareAtRaw) : null;
    const stockNum = stockRaw !== "" ? Number(stockRaw) : NaN;
    const costPriceNum = costPriceRaw !== "" ? Number(costPriceRaw) : null;

    let publishAtDate: Date | null = null;
    if (publishAtRaw) {
      const parsed = new Date(publishAtRaw);
      if (!isNaN(parsed.getTime())) {
        publishAtDate = parsed;
      }
    }

    const parsedRowObj = {
      productSlug,
      name,
      category,
      price: priceNum,
      compareAtPrice: compareAtNum,
      status: statusRaw as ProductStatus,
      publishAt: publishAtDate,
      hsn: hsnRaw || null,
      fabric: fabricRaw || null,
      fit: fitRaw || null,
      color: colorRaw || "",
      size: sizeRaw,
      sku: skuRaw ? skuRaw.trim() : null,
      stock: stockNum,
      costPrice: costPriceNum,
    };

    const validated = rowZodSchema.safeParse(parsedRowObj);
    if (!validated.success) {
      const msg = validated.error.issues.map((iss) => `${iss.path.join(".")}: ${iss.message}`).join(", ");
      errors.push({ rowNumber, message: msg });
      continue;
    }

    rows.push({
      rowNumber,
      ...validated.data,
    });
  }

  return { hasCostPriceColumn, rows, errors };
}

/**
 * Plans the product CSV import without executing any database mutations.
 * Classifies each row as CREATE, UPDATE, UNCHANGED, or ERROR.
 */
export async function planImport(
  input: ParseProductsCsvResult | ProductCsvRow[],
  actorRole?: string
): Promise<ImportPlan> {
  const parsed: ParseProductsCsvResult = Array.isArray(input)
    ? {
        hasCostPriceColumn: actorRole === "OWNER",
        rows: input,
        errors: [],
      }
    : input;
  const existingProducts = await prisma.product.findMany({
    include: {
      category: true,
      variants: true,
    },
    omit: { costPrice: false },
  });

  const productMapBySlug = new Map<string, (typeof existingProducts)[0]>();
  const variantMapBySku = new Map<string, (typeof existingProducts)[0]["variants"][0]>();

  for (const p of existingProducts) {
    productMapBySlug.set(p.slug, p);
    for (const v of p.variants) {
      if (v.sku) {
        variantMapBySku.set(v.sku.toUpperCase(), v);
      }
    }
  }

  // Track batch uniqueness for (productSlug, size, color) and sku
  const seenVariantKeys = new Set<string>();
  const seenSkus = new Set<string>();

  const plannedRows: PlannedRow[] = [];
  let createCount = 0;
  let updateCount = 0;
  let unchangedCount = 0;
  let errorCount = parsed.errors.length;

  for (const err of parsed.errors) {
    plannedRows.push({
      rowNumber: err.rowNumber,
      action: "ERROR",
      productSlug: "",
      name: "",
      color: "",
      size: "",
      sku: null,
      error: err.message,
      data: {} as ProductCsvRow,
    });
  }

  for (const row of parsed.rows) {
    const variantKey = `${row.productSlug.toLowerCase()}::${row.color.toLowerCase()}::${row.size.toLowerCase()}`;
    if (seenVariantKeys.has(variantKey)) {
      plannedRows.push({
        rowNumber: row.rowNumber,
        action: "ERROR",
        productSlug: row.productSlug,
        name: row.name,
        color: row.color,
        size: row.size,
        sku: row.sku,
        error: `Duplicate variant (${row.productSlug}, ${row.size}, ${row.color || "default"}) in CSV file`,
        data: row,
      });
      errorCount++;
      continue;
    }
    seenVariantKeys.add(variantKey);

    if (row.sku) {
      const skuUpper = row.sku.toUpperCase();
      if (seenSkus.has(skuUpper)) {
        plannedRows.push({
          rowNumber: row.rowNumber,
          action: "ERROR",
          productSlug: row.productSlug,
          name: row.name,
          color: row.color,
          size: row.size,
          sku: row.sku,
          error: `Duplicate SKU "${row.sku}" within CSV file`,
          data: row,
        });
        errorCount++;
        continue;
      }
      seenSkus.add(skuUpper);
    }

    const matchedProduct = productMapBySlug.get(row.productSlug);

    if (!matchedProduct) {
      // New Product and new variant
      createCount++;
      plannedRows.push({
        rowNumber: row.rowNumber,
        action: "CREATE",
        productSlug: row.productSlug,
        name: row.name,
        color: row.color,
        size: row.size,
        sku: row.sku,
        newStock: row.stock,
        data: row,
      });
      continue;
    }

    // Existing product: find variant by SKU or by (color, size)
    let matchedVariant = row.sku ? variantMapBySku.get(row.sku.toUpperCase()) : undefined;
    if (!matchedVariant) {
      matchedVariant = matchedProduct.variants.find(
        (v) =>
          v.size.toLowerCase() === row.size.toLowerCase() &&
          v.color.toLowerCase() === row.color.toLowerCase()
      );
    }

    if (!matchedVariant) {
      // New variant on existing product
      createCount++;
      plannedRows.push({
        rowNumber: row.rowNumber,
        action: "CREATE",
        productSlug: row.productSlug,
        name: row.name,
        color: row.color,
        size: row.size,
        sku: row.sku,
        newStock: row.stock,
        data: row,
      });
      continue;
    }

    // Check changes against current DB record
    const targetPricePaise = Math.round(row.price * 100);
    const targetCompareAtPaise = row.compareAtPrice !== null ? Math.round(row.compareAtPrice * 100) : null;
    const targetCostPaise = row.costPrice !== null ? Math.round(row.costPrice * 100) : null;

    const changes: Record<string, { before: unknown; after: unknown }> = {};

    if (matchedProduct.name !== row.name) changes["name"] = { before: matchedProduct.name, after: row.name };
    if (matchedProduct.price !== targetPricePaise) changes["price"] = { before: matchedProduct.price, after: targetPricePaise };
    if ((matchedProduct.compareAtPrice ?? null) !== targetCompareAtPaise) changes["compareAtPrice"] = { before: matchedProduct.compareAtPrice, after: targetCompareAtPaise };
    if (matchedProduct.status !== row.status) changes["status"] = { before: matchedProduct.status, after: row.status };
    if ((matchedProduct.hsn ?? null) !== (row.hsn ?? null)) changes["hsn"] = { before: matchedProduct.hsn, after: row.hsn };
    if ((matchedProduct.fabric ?? null) !== (row.fabric ?? null)) changes["fabric"] = { before: matchedProduct.fabric, after: row.fabric };
    if ((matchedProduct.fit ?? null) !== (row.fit ?? null)) changes["fit"] = { before: matchedProduct.fit, after: row.fit };
    if (
      parsed.hasCostPriceColumn &&
      (actorRole === undefined || actorRole === "OWNER") &&
      targetCostPaise !== null &&
      (matchedProduct.costPrice ?? null) !== targetCostPaise
    ) {
      changes["costPrice"] = { before: matchedProduct.costPrice, after: targetCostPaise };
    }

    if (matchedVariant.stock !== row.stock) {
      changes["stock"] = { before: matchedVariant.stock, after: row.stock };
    }
    if ((matchedVariant.sku ?? null) !== (row.sku ?? null)) {
      changes["sku"] = { before: matchedVariant.sku, after: row.sku };
    }

    if (Object.keys(changes).length > 0) {
      updateCount++;
      plannedRows.push({
        rowNumber: row.rowNumber,
        action: "UPDATE",
        productSlug: row.productSlug,
        name: row.name,
        color: row.color,
        size: row.size,
        sku: row.sku,
        oldStock: matchedVariant.stock,
        newStock: row.stock,
        changes,
        data: row,
      });
    } else {
      unchangedCount++;
      plannedRows.push({
        rowNumber: row.rowNumber,
        action: "UNCHANGED",
        productSlug: row.productSlug,
        name: row.name,
        color: row.color,
        size: row.size,
        sku: row.sku,
        data: row,
      });
    }
  }

  return {
    totalRows: plannedRows.length,
    createCount,
    updateCount,
    unchangedCount,
    errorCount,
    hasCostPrice: parsed.hasCostPriceColumn,
    rows: plannedRows,
  };
}

/**
 * Applies the import plan transactionally per product.
 * Records StockMovement with refType IMPORT for stock delta changes.
 * Skips ERROR rows and returns detailed execution report.
 */
export async function applyImport(
  plan: ImportPlan,
  actorRole?: string,
  actorId?: string
): Promise<ImportApplyResult> {
  const isOwner = actorRole === "OWNER";
  let appliedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;
  let createdProducts = 0;
  let createdVariants = 0;
  let updatedVariants = 0;
  const errors: Array<{ rowNumber: number; error: string }> = [];

  // Group planned rows by productSlug
  const rowsBySlug = new Map<string, PlannedRow[]>();
  for (const r of plan.rows) {
    if (r.action === "ERROR") {
      errorCount++;
      errors.push({ rowNumber: r.rowNumber, error: r.error || "Validation error" });
      continue;
    }
    if (r.action === "UNCHANGED") {
      skippedCount++;
      continue;
    }
    if (!rowsBySlug.has(r.productSlug)) {
      rowsBySlug.set(r.productSlug, []);
    }
    rowsBySlug.get(r.productSlug)!.push(r);
  }

  // Pre-load categories
  const categories = await prisma.category.findMany();

  for (const [slug, pRows] of rowsBySlug.entries()) {
    try {
      await prisma.$transaction(async (tx) => {
        let product = await tx.product.findUnique({
          where: { slug },
          include: { variants: true },
        });

        const firstRow = pRows[0].data;
        let category = categories.find(
          (c) => c.slug.toLowerCase() === firstRow.category.toLowerCase() || c.name.toLowerCase() === firstRow.category.toLowerCase()
        );

        if (!category) {
          // Fallback or create category
          category = await tx.category.create({
            data: {
              name: firstRow.category,
              slug: firstRow.category.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
            },
          });
          categories.push(category);
        }

        const pricePaise = Math.round(firstRow.price * 100);
        const compareAtPaise =
          firstRow.compareAtPrice !== null && firstRow.compareAtPrice !== undefined
            ? Math.round(firstRow.compareAtPrice * 100)
            : null;
        const costPaise =
          isOwner && firstRow.costPrice !== null && firstRow.costPrice !== undefined
            ? Math.round(firstRow.costPrice * 100)
            : null;

        if (!product) {
          // CREATE product
          product = await tx.product.create({
            data: {
              name: firstRow.name,
              slug,
              description: firstRow.name,
              categoryId: category.id,
              price: pricePaise,
              compareAtPrice: compareAtPaise,
              status: firstRow.status,
              publishAt: firstRow.publishAt,
              hsn: firstRow.hsn,
              fabric: firstRow.fabric,
              fit: firstRow.fit,
              ...(isOwner && costPaise !== null ? { costPrice: costPaise } : {}),
            },
            include: { variants: true },
          });
          createdProducts++;
        } else {
          // UPDATE product
          const updateData: Prisma.ProductUncheckedUpdateInput = {
            name: firstRow.name,
            categoryId: category.id,
            price: pricePaise,
            compareAtPrice: compareAtPaise,
            status: firstRow.status,
            publishAt: firstRow.publishAt,
            hsn: firstRow.hsn,
            fabric: firstRow.fabric,
            fit: firstRow.fit,
          };
          if (isOwner && plan.hasCostPrice && costPaise !== null) {
            updateData.costPrice = costPaise;
          }
          await tx.product.update({
            where: { id: product.id },
            data: updateData,
          });
        }

        // Apply variants
        for (const pr of pRows) {
          const rowData = pr.data;
          let variant = product.variants.find(
            (v) =>
              (rowData.sku && v.sku && v.sku.toUpperCase() === rowData.sku.toUpperCase()) ||
              (v.size.toLowerCase() === rowData.size.toLowerCase() && v.color.toLowerCase() === rowData.color.toLowerCase())
          );

          if (!variant) {
            // CREATE variant
            variant = await tx.productVariant.create({
              data: {
                productId: product.id,
                size: rowData.size,
                color: rowData.color || "",
                sku: rowData.sku || null,
                stock: rowData.stock,
              },
            });
            createdVariants++;
            appliedCount++;

            if (rowData.stock > 0) {
              await tx.stockMovement.create({
                data: {
                  variantId: variant.id,
                  delta: rowData.stock,
                  reason: "MANUAL_ADJUST",
                  refType: "IMPORT",
                  actorId: actorId || null,
                },
              });
            }
          } else {
            // UPDATE variant
            const stockDiff = rowData.stock - variant.stock;
            await tx.productVariant.update({
              where: { id: variant.id },
              data: {
                size: rowData.size,
                color: rowData.color || "",
                sku: rowData.sku || null,
                stock: rowData.stock,
              },
            });
            updatedVariants++;
            appliedCount++;

            if (stockDiff !== 0) {
              await tx.stockMovement.create({
                data: {
                  variantId: variant.id,
                  delta: stockDiff,
                  reason: "MANUAL_ADJUST",
                  refType: "IMPORT",
                  actorId: actorId || null,
                },
              });
            }
          }
        }
      });
    } catch (err: unknown) {
      errorCount += pRows.length;
      for (const pr of pRows) {
        errors.push({
          rowNumber: pr.rowNumber,
          error: (err as Error)?.message || "Failed to save product in transaction",
        });
      }
    }
  }

  return {
    appliedCount,
    skippedCount,
    errorCount,
    createdProducts,
    createdVariants,
    updatedVariants,
    errors,
  };
}
