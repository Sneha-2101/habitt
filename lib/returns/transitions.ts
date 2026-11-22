export type ReturnStatus =
  | "REQUESTED"
  | "APPROVED"
  | "REJECTED"
  | "RECEIVED"
  | "REFUNDED"
  | "CANCELLED";

export const LEGAL_RETURN_TRANSITIONS: Record<ReturnStatus, ReturnStatus[]> = {
  REQUESTED: ["APPROVED", "REJECTED", "CANCELLED"],
  APPROVED: ["RECEIVED"],
  RECEIVED: ["REFUNDED"],
  REJECTED: [],
  REFUNDED: [],
  CANCELLED: [],
};

/**
 * Pure transition validator for ReturnStatus.
 * Customer can cancel only while REQUESTED.
 * Staff can approve or reject only while REQUESTED.
 * Staff can mark received only while APPROVED.
 * Refund can be initiated only while RECEIVED.
 */
export function canTransition(from: ReturnStatus | string, to: ReturnStatus | string): boolean {
  const allowed = (LEGAL_RETURN_TRANSITIONS as Record<string, ReturnStatus[] | undefined>)[from];
  return !!allowed?.includes(to as ReturnStatus);
}
