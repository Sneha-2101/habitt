const INFLUENCER_CODE_REGEX = /^[A-Z0-9][A-Z0-9_-]{2,31}$/;

export function normalizeInfluencerCode(
  input: string | null | undefined
): string | null {
  if (typeof input !== "string") return null;
  const cleaned = input.trim().toUpperCase().replace(/\s+/g, "");
  if (!INFLUENCER_CODE_REGEX.test(cleaned)) return null;
  return cleaned;
}

export function parseAttributionCookie(
  value: string | null | undefined
): string | null {
  return normalizeInfluencerCode(value);
}
