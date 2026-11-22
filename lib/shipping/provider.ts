import type { Order, OrderItem, ProductVariant } from "@prisma/client";

export type OrderWithItemsAndVariants = Order & {
  items: (OrderItem & { variant?: ProductVariant | null })[];
};

export interface CreateShipmentResult {
  providerOrderId: string;
  providerShipmentId?: string | null;
  awb?: string | null;
  courierName?: string | null;
  trackingUrl?: string | null;
  labelUrl?: string | null;
}

export interface AssignAwbResult {
  awb: string;
  courierName: string;
  trackingUrl?: string | null;
  labelUrl?: string | null;
}

export interface TrackingEventResult {
  activity: string;
  location?: string | null;
  occurredAt: Date;
  rawStatus: string;
}

export interface TrackingStatusResult {
  rawStatus: string;
  currentLocation?: string | null;
  estimatedDelivery?: Date | null;
  events: TrackingEventResult[];
}

export interface ShippingProvider {
  readonly name: "MANUAL" | "SHIPROCKET";
  createShipment(order: OrderWithItemsAndVariants): Promise<CreateShipmentResult>;
  assignAwb(providerShipmentId: string, providerOrderId?: string): Promise<AssignAwbResult>;
  schedulePickup(providerShipmentId: string, pickupDate?: Date): Promise<{ success: boolean }>;
  track(awb: string): Promise<TrackingStatusResult>;
  cancel(providerShipmentId: string, awb?: string): Promise<{ success: boolean }>;
}
