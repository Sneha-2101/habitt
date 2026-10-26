export interface ShipmentDetails {
  courierName: string;
  awbNumber: string;
  trackingUrl?: string;
  shiprocketOrderId?: string;
}

export interface TrackingEvent {
  activity: string;
  location?: string;
  date: Date;
}

export interface TrackingStatus {
  status: string;
  currentLocation?: string;
  estimatedDelivery?: Date;
  events: TrackingEvent[];
}

export interface ShippingProvider {
  createShipment(orderId: string): Promise<ShipmentDetails>;
  getTrackingStatus(awbNumber: string): Promise<TrackingStatus>;
}
