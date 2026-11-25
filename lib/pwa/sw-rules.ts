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

export function isExcludedSwPath(pathname: string): boolean {
  return SW_EXCLUDED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}
