/**
 * Extracts client IP from request headers.
 * Rule: first entry of x-forwarded-for, else x-real-ip, else "unknown".
 */
export function getClientIp(
  headers: Headers | Record<string, string | string[] | undefined> | null | undefined
): string {
  if (!headers) return "unknown";

  let forwardedFor: string | null = null;
  let realIp: string | null = null;

  if (typeof (headers as Headers).get === "function") {
    forwardedFor = (headers as Headers).get("x-forwarded-for");
    realIp = (headers as Headers).get("x-real-ip");
  } else {
    const record = headers as Record<string, string | string[] | undefined>;
    const fwd = record["x-forwarded-for"] || record["X-Forwarded-For"];
    if (fwd) {
      forwardedFor = Array.isArray(fwd) ? fwd.join(",") : fwd;
    }
    const real = record["x-real-ip"] || record["X-Real-IP"] || record["x-real-ip"];
    if (real) {
      realIp = Array.isArray(real) ? real[0] : real;
    }
  }

  if (forwardedFor && typeof forwardedFor === "string") {
    const firstIp = forwardedFor.split(",")[0]?.trim();
    if (firstIp) return firstIp;
  }

  if (realIp && typeof realIp === "string" && realIp.trim()) {
    return realIp.trim();
  }

  return "unknown";
}

