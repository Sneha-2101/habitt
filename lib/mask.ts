/**
 * Pure synchronous utility to mask email or phone identifiers for safe display.
 * Kept outside of Server Action files to avoid treating pure utility functions
 * as server RPC endpoints.
 */
export function maskIdentifier(identifier: string): string {
  if (identifier.includes("@")) {
    const [local, domain] = identifier.split("@");
    if (!local || local.length <= 1) return `*@${domain || ""}`;
    return `${local[0]}***@${domain}`;
  }
  if (identifier.startsWith("+91") && identifier.length >= 7) {
    const last4 = identifier.slice(-4);
    return `+91******${last4}`;
  }
  if (identifier.length > 4) {
    const last4 = identifier.slice(-4);
    return `******${last4}`;
  }
  return "****";
}

