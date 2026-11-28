/**
 * Helpers for redacting customer PII and raw error details from server logs.
 */

export function maskEmail(email: string | null | undefined): string {
  if (!email) return "***";
  const trimmed = email.trim();
  const atIdx = trimmed.indexOf("@");
  if (atIdx <= 0 || atIdx === trimmed.length - 1) {
    return "***";
  }

  const local = trimmed.slice(0, atIdx);
  const domain = trimmed.slice(atIdx + 1);
  const dotIdx = domain.lastIndexOf(".");

  const localMasked = `${local[0]}***`;
  const domainMasked =
    dotIdx > 0
      ? `${domain[0]}***${domain.slice(dotIdx)}`
      : `${domain[0] ?? "*"}***`;

  return `${localMasked}@${domainMasked}`;
}

export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return "***";
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 2) return "***";
  return `***${digits.slice(-2)}`;
}

export function safeErrorSummary(err: unknown): string {
  if (err instanceof Error) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string" || typeof code === "number") {
      return `${err.name}(${String(code)})`;
    }
    return err.name || "Error";
  }

  if (typeof err === "object" && err !== null) {
    const rec = err as { name?: unknown; code?: unknown };
    const name = typeof rec.name === "string" && rec.name ? rec.name : "Error";
    if (typeof rec.code === "string" || typeof rec.code === "number") {
      return `${name}(${String(rec.code)})`;
    }
    return name;
  }

  return "UnknownError";
}
