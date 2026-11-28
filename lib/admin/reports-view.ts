import type { MarginReportResult } from "./reports";

export type MarginTabState = "hidden" | "error" | "data";

export function getMarginTabState(
  isOwner: boolean,
  marginData: MarginReportResult | null,
  marginError: boolean
): MarginTabState {
  if (!isOwner) return "hidden";
  if (marginError || !marginData) return "error";
  return "data";
}
