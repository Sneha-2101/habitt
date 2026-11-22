import type { ShipmentStatus } from "@prisma/client";

export interface StatusMappingResult {
  status: ShipmentStatus | null;
  known: boolean;
  ignored: boolean;
}

const RAW_STATUS_TABLE: Record<string, ShipmentStatus> = {
  // Created / New
  NEW: "CREATED",
  CREATED: "CREATED",
  ORDER_CREATED: "CREATED",

  // AWB Assigned
  AWB_ASSIGNED: "AWB_ASSIGNED",
  "AWB ASSIGNED": "AWB_ASSIGNED",
  LABEL_GENERATED: "AWB_ASSIGNED",

  // Pickup Scheduled
  PICKUP_SCHEDULED: "PICKUP_SCHEDULED",
  "PICKUP SCHEDULED": "PICKUP_SCHEDULED",
  PICKUP_GENERATED: "PICKUP_SCHEDULED",
  MANIFEST_GENERATED: "PICKUP_SCHEDULED",
  OUT_FOR_PICKUP: "PICKUP_SCHEDULED",

  // In Transit
  PICKED_UP: "IN_TRANSIT",
  "PICKED UP": "IN_TRANSIT",
  IN_TRANSIT: "IN_TRANSIT",
  "IN TRANSIT": "IN_TRANSIT",
  SHIPPED: "IN_TRANSIT",
  DISPATCHED: "IN_TRANSIT",
  REACHED_AT_DESTINATION: "IN_TRANSIT",
  TRANSIT: "IN_TRANSIT",

  // Out for Delivery
  OUT_FOR_DELIVERY: "OUT_FOR_DELIVERY",
  "OUT FOR DELIVERY": "OUT_FOR_DELIVERY",

  // Delivered
  DELIVERED: "DELIVERED",

  // RTO
  RTO_INITIATED: "RTO_INITIATED",
  "RTO INITIATED": "RTO_INITIATED",
  RTO_OFD: "RTO_INITIATED",
  RTO_IN_TRANSIT: "RTO_INITIATED",
  RTO_NDR: "RTO_INITIATED",
  RTO_DELIVERED: "RTO_DELIVERED",
  "RTO DELIVERED": "RTO_DELIVERED",
  RTO_ACKNOWLEDGED: "RTO_DELIVERED",

  // Cancelled / Failed
  CANCELED: "CANCELLED",
  CANCELLED: "CANCELLED",
  LOST: "FAILED",
  DAMAGED: "FAILED",
  FAILED: "FAILED",
  UNDELIVERED: "FAILED",
};

/**
 * Maps raw Shiprocket status string to canonical ShipmentStatus.
 * Unknown raw statuses map to IN_TRANSIT only if shipment has already shipped;
 * otherwise ignored and flagged, never throws.
 */
export function mapShiprocketStatus(
  rawStatus: string,
  currentStatus?: ShipmentStatus
): StatusMappingResult {
  if (!rawStatus || typeof rawStatus !== "string") {
    return { status: null, known: false, ignored: true };
  }

  const normalized = rawStatus.trim().toUpperCase();
  const direct = RAW_STATUS_TABLE[normalized];

  if (direct) {
    return { status: direct, known: true, ignored: false };
  }

  // Check if already shipped
  const alreadyShipped =
    currentStatus === "AWB_ASSIGNED" ||
    currentStatus === "PICKUP_SCHEDULED" ||
    currentStatus === "IN_TRANSIT" ||
    currentStatus === "OUT_FOR_DELIVERY";

  if (alreadyShipped) {
    return { status: "IN_TRANSIT", known: false, ignored: false };
  }

  return { status: null, known: false, ignored: true };
}
