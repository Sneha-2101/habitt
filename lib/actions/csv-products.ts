"use server";

import { requireStaff } from "@/lib/guards";
import {
  parseProductsCsv,
  planImport,
  applyImport,
  type ImportPlan,
  type ImportApplyResult,
} from "@/lib/admin/csv-products";

export async function parseAndPlanProductsCsvAction(csvContent: string): Promise<ImportPlan> {
  const staff = await requireStaff();
  const parsed = parseProductsCsv(csvContent, staff.role);
  if (parsed.errors.length > 0) {
    throw new Error(parsed.errors.map((e) => `Row ${e.rowNumber}: ${e.message}`).join("; "));
  }
  return planImport(parsed.rows, staff.role);
}

export async function applyProductsImportAction(plan: ImportPlan): Promise<ImportApplyResult> {
  const staff = await requireStaff();
  return applyImport(plan, staff.role, staff.id);
}
