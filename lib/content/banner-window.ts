export interface BannerWindowInput {
  isActive: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
}

/**
 * Pure helper determining whether a HomeBanner is currently active within its schedule window.
 */
export function isBannerActiveAt(
  banner: BannerWindowInput,
  now: Date = new Date()
): boolean {
  if (!banner.isActive) return false;
  if (banner.startsAt && banner.startsAt.getTime() > now.getTime()) return false;
  if (banner.endsAt && banner.endsAt.getTime() < now.getTime()) return false;
  return true;
}
