export interface IndianState {
  name: string;
  code: string; // 2-letter postal abbreviation, uppercase
  tin: string; // 2-digit GST state code
  aliases: string[];
}

export const INDIAN_STATES_GST: IndianState[] = [
  { name: "Jammu and Kashmir", code: "JK", tin: "01", aliases: ["j&k", "jammu & kashmir", "jammu kashmir"] },
  { name: "Himachal Pradesh", code: "HP", tin: "02", aliases: ["himachal"] },
  { name: "Punjab", code: "PB", tin: "03", aliases: [] },
  { name: "Chandigarh", code: "CH", tin: "04", aliases: [] },
  { name: "Uttarakhand", code: "UK", tin: "05", aliases: ["uttaranchal", "ua"] },
  { name: "Haryana", code: "HR", tin: "06", aliases: [] },
  { name: "Delhi", code: "DL", tin: "07", aliases: ["new delhi", "nct of delhi", "delhi nct"] },
  { name: "Rajasthan", code: "RJ", tin: "08", aliases: [] },
  { name: "Uttar Pradesh", code: "UP", tin: "09", aliases: ["u.p."] },
  { name: "Bihar", code: "BR", tin: "10", aliases: ["bh"] },
  { name: "Sikkim", code: "SK", tin: "11", aliases: [] },
  { name: "Arunachal Pradesh", code: "AR", tin: "12", aliases: ["arunachal"] },
  { name: "Nagaland", code: "NL", tin: "13", aliases: [] },
  { name: "Manipur", code: "MN", tin: "14", aliases: [] },
  { name: "Mizoram", code: "MZ", tin: "15", aliases: [] },
  { name: "Tripura", code: "TR", tin: "16", aliases: [] },
  { name: "Meghalaya", code: "ML", tin: "17", aliases: [] },
  { name: "Assam", code: "AS", tin: "18", aliases: [] },
  { name: "West Bengal", code: "WB", tin: "19", aliases: ["bengal", "w.b."] },
  { name: "Jharkhand", code: "JH", tin: "20", aliases: [] },
  { name: "Odisha", code: "OR", tin: "21", aliases: ["orissa", "od"] },
  { name: "Chhattisgarh", code: "CG", tin: "22", aliases: ["chattisgarh", "ct"] },
  { name: "Madhya Pradesh", code: "MP", tin: "23", aliases: ["m.p."] },
  { name: "Gujarat", code: "GJ", tin: "24", aliases: [] },
  { name: "Dadra and Nagar Haveli and Daman and Diu", code: "DH", tin: "26", aliases: ["daman and diu", "dadra and nagar haveli", "daman", "diu", "dd", "dn"] },
  { name: "Maharashtra", code: "MH", tin: "27", aliases: [] },
  { name: "Andhra Pradesh", code: "AP", tin: "28", aliases: ["a.p."] },
  { name: "Karnataka", code: "KA", tin: "29", aliases: [] },
  { name: "Goa", code: "GA", tin: "30", aliases: [] },
  { name: "Lakshadweep", code: "LD", tin: "31", aliases: [] },
  { name: "Kerala", code: "KL", tin: "32", aliases: [] },
  { name: "Puducherry", code: "PY", tin: "34", aliases: ["pondicherry", "pondy"] },
  { name: "Andaman and Nicobar Islands", code: "AN", tin: "35", aliases: ["andaman & nicobar", "andaman", "nicobar"] },
  { name: "Telangana", code: "TS", tin: "36", aliases: ["tg"] },
  { name: "Andhra Pradesh (New)", code: "AD", tin: "37", aliases: [] },
  { name: "Ladakh", code: "LA", tin: "38", aliases: [] },
  { name: "Other Territory", code: "OT", tin: "97", aliases: [] },
];

/**
 * Normalizes any Indian state input (name, 2-letter abbreviation, or 2-digit TIN)
 * to its canonical IndianState record.
 */
export function normalizeState(input: string | null | undefined): IndianState | null {
  if (!input) return null;
  const raw = input.trim().toLowerCase();
  if (!raw) return null;

  for (const s of INDIAN_STATES_GST) {
    if (s.name.toLowerCase() === raw) return s;
    if (s.code.toLowerCase() === raw) return s;
    if (s.tin === raw) return s;
    if (s.aliases.some((a) => a.toLowerCase() === raw)) return s;
  }

  // Substring match fallback for inputs like "Delhi (NCT)"
  for (const s of INDIAN_STATES_GST) {
    if (raw.includes(s.name.toLowerCase()) || s.name.toLowerCase().includes(raw)) {
      return s;
    }
  }

  return null;
}

/**
 * Checks whether two state representations refer to the exact same Indian state.
 * Returns false if either cannot be normalized.
 */
export function isSameState(stateA: string | null | undefined, stateB: string | null | undefined): boolean {
  const normA = normalizeState(stateA);
  const normB = normalizeState(stateB);
  if (!normA || !normB) return false;

  // Handle AP TIN 28/37 equivalence
  if ((normA.code === "AP" || normA.code === "AD") && (normB.code === "AP" || normB.code === "AD")) {
    return true;
  }

  return normA.code === normB.code;
}
