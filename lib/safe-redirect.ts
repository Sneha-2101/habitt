export function safeRedirect(next: string | null | undefined, fallback = "/"): string {
  if (!next || typeof next !== "string") {
    return fallback;
  }
  const trimmed = next.trim();
  // Must start with exactly one '/', and not followed by another '/' or '\'
  if (!trimmed.startsWith("/") || trimmed.startsWith("//") || trimmed.startsWith("/\\")) {
    return fallback;
  }
  // Reject any protocol-relative or url with protocol
  if (trimmed.includes(":") || trimmed.includes("\\")) {
    return fallback;
  }
  try {
    const url = new URL(trimmed, "http://localhost");
    if (url.origin !== "http://localhost") return fallback;
    if (!url.pathname.startsWith("/")) return fallback;
  } catch {
    return fallback;
  }
  return trimmed;
}
