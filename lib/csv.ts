/**
 * Sanitizes a cell for safe CSV export (formula injection / CSV injection protection).
 * Rule: quote cells properly, double internal quotes, and prefix a single quote when a value starts with =, +, -, @, tab, or carriage return.
 */
export function sanitizeCsvCell(value: unknown): string {
  if (value === null || value === undefined) {
    return '""';
  }

  let str = typeof value === "string" ? value : String(value);

  // If value starts with formula triggers (=, +, -, @, \t, \r), prefix with a single quote
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }

  // Escape double quotes by doubling them
  const escaped = str.replace(/"/g, '""');
  return `"${escaped}"`;
}

