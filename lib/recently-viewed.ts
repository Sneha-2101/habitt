"use client";

const RECENTLY_VIEWED_KEY = "habitt_recently_viewed";

export interface RecentlyViewedItem {
  id: string;
  name: string;
  slug: string;
  price: number;
  category: string;
  imageUrl?: string;
}

export function recordRecentlyViewed(item: RecentlyViewedItem) {
  if (typeof window === "undefined") return;

  try {
    const existingRaw = localStorage.getItem(RECENTLY_VIEWED_KEY);
    const existing: RecentlyViewedItem[] = existingRaw ? JSON.parse(existingRaw) : [];

    // Filter out duplicate if present
    const filtered = existing.filter((i) => i.id !== item.id);
    const updated = [item, ...filtered].slice(0, 8); // Keep last 8

    localStorage.setItem(RECENTLY_VIEWED_KEY, JSON.stringify(updated));
  } catch (e) {
    console.error("Failed to update recently viewed items:", e);
  }
}

export function getRecentlyViewed(): RecentlyViewedItem[] {
  if (typeof window === "undefined") return [];

  try {
    const existingRaw = localStorage.getItem(RECENTLY_VIEWED_KEY);
    return existingRaw ? JSON.parse(existingRaw) : [];
  } catch (e) {
    console.error("Failed to read recently viewed items:", e);
    return [];
  }
}
