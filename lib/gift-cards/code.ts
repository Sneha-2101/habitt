import crypto from "node:crypto";

export const GIFT_CARD_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const GIFT_CARD_CODE_LENGTH = 12;

const ALLOWED_CHARS = new Set(GIFT_CARD_ALPHABET.split(""));

/**
 * Formats a 12-character normalized gift card code as `GC-XXXX-XXXX-XXXX`.
 */
export function formatGiftCardCode(normalized: string): string {
  return `GC-${normalized.slice(0, 4)}-${normalized.slice(4, 8)}-${normalized.slice(8, 12)}`;
}

/**
 * Normalizes user-entered gift card code:
 * trims, uppercases, removes spaces and hyphens, strips a leading "GC",
 * and returns the 12-character code or null if length/alphabet is invalid.
 */
export function normalizeCode(input: string): string | null {
  if (typeof input !== "string") return null;
  let cleaned = input.trim().toUpperCase().replace(/[\s-]+/g, "");
  if (cleaned.startsWith("GC")) {
    cleaned = cleaned.slice(2);
  }
  if (cleaned.length !== GIFT_CARD_CODE_LENGTH) {
    return null;
  }
  for (let i = 0; i < cleaned.length; i += 1) {
    if (!ALLOWED_CHARS.has(cleaned[i])) {
      return null;
    }
  }
  return cleaned;
}

/**
 * Computes SHA-256 hex digest of a normalized gift card code.
 */
export function hashCode(normalized: string): string {
  return crypto.createHash("sha256").update(normalized, "utf8").digest("hex");
}

/**
 * Returns the last 4 characters of a normalized gift card code.
 */
export function getCodeLast4(normalized: string): string {
  return normalized.slice(-4);
}

/**
 * Generates a random gift card code formatted as `GC-XXXX-XXXX-XXXX`.
 */
export function generateGiftCardCode(): string {
  let raw = "";
  for (let i = 0; i < GIFT_CARD_CODE_LENGTH; i += 1) {
    const idx = crypto.randomInt(0, GIFT_CARD_ALPHABET.length);
    raw += GIFT_CARD_ALPHABET[idx];
  }
  return formatGiftCardCode(raw);
}
