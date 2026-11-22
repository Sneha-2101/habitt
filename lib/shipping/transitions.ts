import type { ShipmentStatus } from "@prisma/client";
import { createHash } from "node:crypto";

// Relative ranks for normal forward shipment progression
const PROGRESSION_RANK: Record<ShipmentStatus, number> = {
  CREATED: 1,
  AWB_ASSIGNED: 2,
  PICKUP_SCHEDULED: 3,
  IN_TRANSIT: 4,
  OUT_FOR_DELIVERY: 5,
  DELIVERED: 6,
  RTO_INITIATED: 5,
  RTO_DELIVERED: 6,
  CANCELLED: 99,
  FAILED: 99,
};

const TERMINAL_STATUSES = new Set<ShipmentStatus>([
  "DELIVERED",
  "RTO_DELIVERED",
  "CANCELLED",
]);

/**
 * Checks whether transitioning from `current` to `target` is legal.
 * Invariants:
 * - Never move backwards.
 * - DELIVERED and RTO_DELIVERED are strictly terminal.
 * - Out-of-order older events are ignored.
 */
export function canShipmentTransition(
  current: ShipmentStatus,
  target: ShipmentStatus
): boolean {
  if (current === target) {
    return true; // Idempotent
  }

  // Terminal statuses can never regress or change
  if (TERMINAL_STATUSES.has(current)) {
    return false;
  }

  if (target === "CANCELLED") {
    // Cannot cancel after delivery
    return !TERMINAL_STATUSES.has(current);
  }

  if (target === "FAILED") {
    return !TERMINAL_STATUSES.has(current);
  }

  if (target === "RTO_INITIATED") {
    return (
      current === "IN_TRANSIT" ||
      current === "OUT_FOR_DELIVERY" ||
      current === "PICKUP_SCHEDULED"
    );
  }

  if (target === "RTO_DELIVERED") {
    return (
      current === "RTO_INITIATED" ||
      current === "IN_TRANSIT" ||
      current === "OUT_FOR_DELIVERY"
    );
  }

  const currentRank = PROGRESSION_RANK[current] ?? 0;
  const targetRank = PROGRESSION_RANK[target] ?? 0;

  // Enforce forward-only progression
  return targetRank >= currentRank;
}

/**
 * Maps a ShipmentStatus to the corresponding Order fulfilment status change,
 * adhering to legal transitions in lib/orders/transitions.ts.
 */
export function mapShipmentToOrderTransition(
  shipmentStatus: ShipmentStatus
): "SHIPPED" | "DELIVERED" | "RTO" | null {
  switch (shipmentStatus) {
    case "AWB_ASSIGNED":
    case "PICKUP_SCHEDULED":
    case "IN_TRANSIT":
    case "OUT_FOR_DELIVERY":
      return "SHIPPED";
    case "DELIVERED":
      return "DELIVERED";
    case "RTO_DELIVERED":
      return "RTO";
    default:
      return null;
  }
}

/**
 * Stable dedupeKey computation for shipment events.
 * Hash of awb + rawStatus + occurredAt (ISO string).
 */
export function computeShipmentEventDedupeKey(
  awb: string,
  rawStatus: string,
  occurredAt: string | Date
): string {
  const normAwb = (awb || "").trim();
  const normStatus = (rawStatus || "").trim().toUpperCase();
  const dateObj = occurredAt instanceof Date ? occurredAt : new Date(occurredAt);
  const dateIso = isNaN(dateObj.getTime()) ? String(occurredAt) : dateObj.toISOString();

  return createHash("sha256")
    .update(`${normAwb}:${normStatus}:${dateIso}`)
    .digest("hex");
}
