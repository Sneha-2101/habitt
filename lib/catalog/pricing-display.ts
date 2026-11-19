export function savingsPaise(
  price: number | null | undefined,
  compareAt: number | null | undefined
): number | null {
  if (
    typeof price !== "number" ||
    typeof compareAt !== "number" ||
    isNaN(price) ||
    isNaN(compareAt)
  ) {
    return null;
  }
  if (compareAt <= price) {
    return null;
  }
  return compareAt - price;
}

export function savingsPercent(
  price: number | null | undefined,
  compareAt: number | null | undefined
): number | null {
  const diff = savingsPaise(price, compareAt);
  if (diff === null || !compareAt || compareAt <= 0) {
    return null;
  }
  return Math.floor((diff / compareAt) * 100);
}
