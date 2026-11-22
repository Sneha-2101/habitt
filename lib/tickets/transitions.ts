import type { TicketStatus } from "@prisma/client";

export const ALLOWED_STAFF_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  OPEN: ["IN_PROGRESS", "WAITING_CUSTOMER", "RESOLVED", "CLOSED"],
  IN_PROGRESS: ["WAITING_CUSTOMER", "RESOLVED", "CLOSED"],
  WAITING_CUSTOMER: ["IN_PROGRESS", "RESOLVED", "CLOSED"],
  RESOLVED: ["OPEN", "CLOSED"],
  CLOSED: [], // Terminal
};

/**
 * Checks whether a ticket can transition between two statuses.
 * - Customer reply on RESOLVED reopens to OPEN if within 14 days of resolvedAt.
 * - CLOSED is terminal for both customers and staff.
 */
export function canTicketTransition(
  current: TicketStatus,
  target: TicketStatus,
  options?: {
    isCustomer?: boolean;
    resolvedAt?: Date | null;
    now?: Date;
  }
): boolean {
  if (current === target) return true;
  if (current === "CLOSED") return false; // CLOSED is terminal

  const isCustomer = options?.isCustomer ?? false;
  const now = options?.now ?? new Date();

  if (isCustomer) {
    if (current === "RESOLVED" && target === "OPEN") {
      if (!options?.resolvedAt) return false;
      const elapsedMs = now.getTime() - options.resolvedAt.getTime();
      const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000;
      return elapsedMs <= fourteenDaysMs;
    }
    // Customers can only reopen a RESOLVED ticket (by replying) or keep it as is
    return false;
  }

  // Staff transitions
  const allowed = ALLOWED_STAFF_TRANSITIONS[current] || [];
  return allowed.includes(target);
}
