export function getSiteUrl(): string | null {
  const raw =
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    process.env.NEXTAUTH_URL?.trim() ||
    "";
  if (!raw) return null;

  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return null;
    }
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`.replace(/\/+$/, "");
  } catch {
    return null;
  }
}
