export function formatReviewerName(name: string | null | undefined): string {
  if (!name || !name.trim()) return "Anonymous";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) {
    return parts[0];
  }
  const firstName = parts[0];
  const lastInitial = parts[parts.length - 1][0]?.toUpperCase() || "";
  return lastInitial ? `${firstName} ${lastInitial}.` : firstName;
}

