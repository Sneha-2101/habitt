/**
 * Invoice and Credit Note sequence number formatters.
 * Tax Invoice: <prefix>/<financialYear>/<5-digit padded sequence> e.g. HB/2026-27/00001
 * Credit Note: <prefix>/CN/<financialYear>/<5-digit padded sequence> e.g. HB/CN/2026-27/00001
 */

export const DEFAULT_INVOICE_PREFIX = "HB";

export function formatInvoiceNumber(
  prefix: string = DEFAULT_INVOICE_PREFIX,
  financialYear: string,
  seq: number
): string {
  const cleanPrefix = (prefix || DEFAULT_INVOICE_PREFIX).trim().toUpperCase();
  const paddedSeq = String(seq).padStart(5, "0");
  return `${cleanPrefix}/${financialYear}/${paddedSeq}`;
}

export function formatCreditNoteNumber(
  prefix: string = DEFAULT_INVOICE_PREFIX,
  financialYear: string,
  seq: number
): string {
  const cleanPrefix = (prefix || DEFAULT_INVOICE_PREFIX).trim().toUpperCase();
  const paddedSeq = String(seq).padStart(5, "0");
  return `${cleanPrefix}/CN/${financialYear}/${paddedSeq}`;
}
