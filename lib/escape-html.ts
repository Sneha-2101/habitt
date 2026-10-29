/**
 * HTML Escaping utility to protect against Cross-Site Scripting (XSS).
 * Replaces &, <, >, ", and ' with corresponding HTML entities.
 * Safely handles null, undefined, numbers, and booleans.
 */
export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  const str = typeof value === "string" ? value : String(value);

  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

