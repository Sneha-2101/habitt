export interface AttributionCandidate {
  id: string;
  active: boolean;
}

export type AttributionSource = "COUPON" | "LINK";

export interface ResolvedAttribution {
  influencerId: string;
  source: AttributionSource;
}

export function resolveAttribution(input: {
  couponInfluencer: AttributionCandidate | null | undefined;
  cookieInfluencer: AttributionCandidate | null | undefined;
}): ResolvedAttribution | null {
  if (input.couponInfluencer && input.couponInfluencer.active) {
    return { influencerId: input.couponInfluencer.id, source: "COUPON" };
  }
  if (input.cookieInfluencer && input.cookieInfluencer.active) {
    return { influencerId: input.cookieInfluencer.id, source: "LINK" };
  }
  return null;
}
