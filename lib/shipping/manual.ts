import type {
  ShippingProvider,
  OrderWithItemsAndVariants,
  CreateShipmentResult,
  AssignAwbResult,
  TrackingStatusResult,
} from "./provider";

/**
 * ManualShippingProvider: no network calls.
 * Used when Shiprocket is disabled or when staff enters tracking manually.
 */
export class ManualShippingProvider implements ShippingProvider {
  readonly name = "MANUAL" as const;

  async createShipment(order: OrderWithItemsAndVariants): Promise<CreateShipmentResult> {
    return {
      providerOrderId: `manual_${order.id}`,
      providerShipmentId: `manual_shpm_${order.id}`,
      awb: order.awbNumber || null,
      courierName: order.courierName || null,
      trackingUrl: order.trackingUrl || null,
    };
  }

  async assignAwb(providerShipmentId: string): Promise<AssignAwbResult> {
    return {
      awb: `MANUAL_${providerShipmentId}`,
      courierName: "Manual Courier",
    };
  }

  async schedulePickup(): Promise<{ success: boolean }> {
    return { success: true };
  }

  async track(awb: string): Promise<TrackingStatusResult> {
    return {
      rawStatus: "IN_TRANSIT",
      events: [
        {
          activity: `Manual tracking for AWB: ${awb}`,
          occurredAt: new Date(),
          rawStatus: "IN_TRANSIT",
        },
      ],
    };
  }

  async cancel(): Promise<{ success: boolean }> {
    return { success: true };
  }
}

export const manualShippingProvider = new ManualShippingProvider();
