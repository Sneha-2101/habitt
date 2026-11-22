import { describe, it, expect } from "vitest";
import { mapShiprocketStatus } from "@/lib/shipping/status-map";
import {
  canShipmentTransition,
  mapShipmentToOrderTransition,
  computeShipmentEventDedupeKey,
} from "@/lib/shipping/transitions";

describe("Shipping Status & Transitions Pure Rules", () => {
  describe("1. Table-driven Shiprocket status mapping", () => {
    it("maps known raw statuses accurately", () => {
      expect(mapShiprocketStatus("NEW").status).toBe("CREATED");
      expect(mapShiprocketStatus("AWB ASSIGNED").status).toBe("AWB_ASSIGNED");
      expect(mapShiprocketStatus("LABEL_GENERATED").status).toBe("AWB_ASSIGNED");
      expect(mapShiprocketStatus("PICKUP_SCHEDULED").status).toBe("PICKUP_SCHEDULED");
      expect(mapShiprocketStatus("MANIFEST_GENERATED").status).toBe("PICKUP_SCHEDULED");
      expect(mapShiprocketStatus("IN TRANSIT").status).toBe("IN_TRANSIT");
      expect(mapShiprocketStatus("DISPATCHED").status).toBe("IN_TRANSIT");
      expect(mapShiprocketStatus("OUT FOR DELIVERY").status).toBe("OUT_FOR_DELIVERY");
      expect(mapShiprocketStatus("DELIVERED").status).toBe("DELIVERED");
      expect(mapShiprocketStatus("RTO INITIATED").status).toBe("RTO_INITIATED");
      expect(mapShiprocketStatus("RTO DELIVERED").status).toBe("RTO_DELIVERED");
      expect(mapShiprocketStatus("CANCELED").status).toBe("CANCELLED");
      expect(mapShiprocketStatus("LOST").status).toBe("FAILED");
      expect(mapShiprocketStatus("DAMAGED").status).toBe("FAILED");
    });

    it("handles unknown raw statuses safely", () => {
      // Not yet shipped: unknown status is ignored and flagged, never throws
      const unkPreShip = mapShiprocketStatus("CUSTOM_CARRIER_EVENT_123", "CREATED");
      expect(unkPreShip.status).toBeNull();
      expect(unkPreShip.known).toBe(false);
      expect(unkPreShip.ignored).toBe(true);

      // Already shipped: maps unknown status to IN_TRANSIT without throwing
      const unkPostShip = mapShiprocketStatus("CUSTOM_CARRIER_EVENT_123", "IN_TRANSIT");
      expect(unkPostShip.status).toBe("IN_TRANSIT");
      expect(unkPostShip.known).toBe(false);
      expect(unkPostShip.ignored).toBe(false);

      const unkPostAwb = mapShiprocketStatus("CUSTOM_HUB_ARRIVED", "AWB_ASSIGNED");
      expect(unkPostAwb.status).toBe("IN_TRANSIT");
      expect(unkPostAwb.known).toBe(false);
      expect(unkPostAwb.ignored).toBe(false);
    });
  });

  describe("2. Forward-only transition enforcement", () => {
    it("allows legal forward progression", () => {
      expect(canShipmentTransition("CREATED", "AWB_ASSIGNED")).toBe(true);
      expect(canShipmentTransition("AWB_ASSIGNED", "PICKUP_SCHEDULED")).toBe(true);
      expect(canShipmentTransition("PICKUP_SCHEDULED", "IN_TRANSIT")).toBe(true);
      expect(canShipmentTransition("IN_TRANSIT", "OUT_FOR_DELIVERY")).toBe(true);
      expect(canShipmentTransition("OUT_FOR_DELIVERY", "DELIVERED")).toBe(true);
    });

    it("rejects backwards regression (out-of-order older events)", () => {
      expect(canShipmentTransition("IN_TRANSIT", "AWB_ASSIGNED")).toBe(false);
      expect(canShipmentTransition("OUT_FOR_DELIVERY", "IN_TRANSIT")).toBe(false);
      expect(canShipmentTransition("DELIVERED", "OUT_FOR_DELIVERY")).toBe(false);
      expect(canShipmentTransition("DELIVERED", "IN_TRANSIT")).toBe(false);
      expect(canShipmentTransition("RTO_DELIVERED", "RTO_INITIATED")).toBe(false);
    });

    it("treats DELIVERED, RTO_DELIVERED, CANCELLED as strictly terminal", () => {
      expect(canShipmentTransition("DELIVERED", "FAILED")).toBe(false);
      expect(canShipmentTransition("DELIVERED", "CANCELLED")).toBe(false);
      expect(canShipmentTransition("RTO_DELIVERED", "DELIVERED")).toBe(false);
      expect(canShipmentTransition("CANCELLED", "IN_TRANSIT")).toBe(false);
    });

    it("supports RTO transitions from transit", () => {
      expect(canShipmentTransition("IN_TRANSIT", "RTO_INITIATED")).toBe(true);
      expect(canShipmentTransition("OUT_FOR_DELIVERY", "RTO_INITIATED")).toBe(true);
      expect(canShipmentTransition("RTO_INITIATED", "RTO_DELIVERED")).toBe(true);
    });

    it("is idempotent when current equals target", () => {
      expect(canShipmentTransition("IN_TRANSIT", "IN_TRANSIT")).toBe(true);
      expect(canShipmentTransition("DELIVERED", "DELIVERED")).toBe(true);
    });
  });

  describe("3. Order fulfilment transition mapping", () => {
    it("maps shipment status to allowed order status", () => {
      expect(mapShipmentToOrderTransition("AWB_ASSIGNED")).toBe("SHIPPED");
      expect(mapShipmentToOrderTransition("PICKUP_SCHEDULED")).toBe("SHIPPED");
      expect(mapShipmentToOrderTransition("IN_TRANSIT")).toBe("SHIPPED");
      expect(mapShipmentToOrderTransition("OUT_FOR_DELIVERY")).toBe("SHIPPED");
      expect(mapShipmentToOrderTransition("DELIVERED")).toBe("DELIVERED");
      expect(mapShipmentToOrderTransition("RTO_DELIVERED")).toBe("RTO");
      expect(mapShipmentToOrderTransition("CREATED")).toBeNull();
      expect(mapShipmentToOrderTransition("FAILED")).toBeNull();
    });
  });

  describe("4. Stable Dedupe Key", () => {
    it("produces identical hash for identical AWB, status and timestamp", () => {
      const dt = new Date("2026-11-22T10:00:00.000Z");
      const k1 = computeShipmentEventDedupeKey("AWB12345", "DELIVERED", dt);
      const k2 = computeShipmentEventDedupeKey("  AWB12345  ", "delivered", "2026-11-22T10:00:00.000Z");
      expect(k1).toBe(k2);
      expect(k1).toHaveLength(64);
    });

    it("produces different hash for different events or times", () => {
      const k1 = computeShipmentEventDedupeKey("AWB12345", "IN_TRANSIT", "2026-11-22T10:00:00.000Z");
      const k2 = computeShipmentEventDedupeKey("AWB12345", "OUT_FOR_DELIVERY", "2026-11-22T10:00:00.000Z");
      const k3 = computeShipmentEventDedupeKey("AWB12345", "IN_TRANSIT", "2026-11-22T11:00:00.000Z");
      expect(k1).not.toBe(k2);
      expect(k1).not.toBe(k3);
    });
  });
});
