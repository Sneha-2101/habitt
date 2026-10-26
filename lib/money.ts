/** All prices/amounts are stored as integer paise. Never use floats for money. */

export function formatINR(paise: number): string {
  return "₹" + (paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

export function rupeesToPaise(rupees: number): number {
  return Math.round(rupees * 100);
}

export function generateDisplayId(): string {
  const n = Math.floor(10000 + Math.random() * 89999);
  return `HB-${n}`;
}
