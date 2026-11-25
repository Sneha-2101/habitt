export const SW_CACHE_NAME = "habitt-offline-v1";
export const SW_OFFLINE_URL = "/offline";

export const SW_EXCLUDED_PREFIXES = [
  "/api/",
  "/admin/",
  "/checkout",
  "/account",
  "/staff",
  "/auth",
] as const;

export const SW_EXCLUDED_BASES = [
  "/admin",
  "/checkout",
  "/account",
  "/staff",
  "/auth",
] as const;

export function isExcludedSwPath(pathname: string): boolean {
  if (pathname.startsWith("/api/")) {
    return true;
  }
  return SW_EXCLUDED_BASES.some(
    (base) => pathname === base || pathname.startsWith(`${base}/`)
  );
}
