import { ShippingProvider, ShipmentDetails, TrackingStatus } from "./types";
import { prisma } from "@/lib/prisma";

const SHIPROCKET_BASE_URL = "https://apiv2.shiprocket.in/v1/external";

export class ShiprocketProvider implements ShippingProvider {
  private email = process.env.SHIPROCKET_EMAIL;
  private password = process.env.SHIPROCKET_PASSWORD;
  private pickupLocation = process.env.SHIPROCKET_PICKUP_LOCATION || "Primary";
  private token: string | null = null;
  private tokenExpiresAt: number = 0;

  private async getAuthToken(): Promise<string> {
    if (!this.email || !this.password) {
      throw new Error("Shiprocket credentials (SHIPROCKET_EMAIL/SHIPROCKET_PASSWORD) are not set in environment.");
    }

    if (this.token && Date.now() < this.tokenExpiresAt) {
      return this.token;
    }

    const response = await fetch(`${SHIPROCKET_BASE_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: this.email,
        password: this.password,
      }),
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(`Shiprocket Auth Failed: ${err.message || response.statusText}`);
    }

    const data = await response.json();
    this.token = data.token;
    // Shiprocket tokens last ~10 days; set expiration to 9 days for safety
    this.tokenExpiresAt = Date.now() + 9 * 24 * 60 * 60 * 1000;
    return this.token!;
  }

  async createShipment(orderId: string): Promise<ShipmentDetails> {
    const token = await this.getAuthToken();
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    });

    if (!order) throw new Error(`Order ${orderId} not found`);

    const address = typeof order.shippingAddress === "object" && order.shippingAddress !== null
      ? (order.shippingAddress as Record<string, any>)
      : {};

    const payload = {
      order_id: order.displayId,
      order_date: order.createdAt.toISOString().replace("T", " ").substring(0, 19),
      pickup_location: this.pickupLocation,
      billing_customer_name: order.customerName,
      billing_last_name: "",
      billing_address: address.addressLine1 || address.street || address.line1 || "Street Address",
      billing_address_2: address.addressLine2 || address.line2 || "",
      billing_city: address.city || "City",
      billing_pincode: address.pincode || address.postalCode || "400001",
      billing_state: address.state || "State",
      billing_country: "India",
      billing_email: order.customerEmail || "customer@example.com",
      billing_phone: order.customerPhone,
      shipping_is_billing: true,
      order_items: order.items.map((item) => ({
        name: item.name,
        sku: `${item.productId}-${item.size}`,
        units: item.qty,
        selling_price: (item.unitPrice / 100).toFixed(2),
      })),
      payment_method: "Prepaid",
      sub_total: (order.subtotal / 100).toFixed(2),
      length: 10,
      breadth: 10,
      height: 10,
      weight: 0.5,
    };

    const response = await fetch(`${SHIPROCKET_BASE_URL}/orders/create/adhoc`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(`Shiprocket Create Order Error: ${err.message || JSON.stringify(err)}`);
    }

    const resData = await response.json();

    return {
      shiprocketOrderId: String(resData.order_id),
      courierName: resData.courier_name || "Shiprocket Partner",
      awbNumber: resData.awb_code || String(resData.shipment_id),
      trackingUrl: `https://shiprocket.co/tracking/${resData.awb_code || resData.shipment_id}`,
    };
  }

  async getTrackingStatus(awbNumber: string): Promise<TrackingStatus> {
    const token = await this.getAuthToken();

    const response = await fetch(`${SHIPROCKET_BASE_URL}/courier/track/awb/${awbNumber}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Shiprocket Tracking Error: ${response.statusText}`);
    }

    const data = await response.json();
    const trackData = data.tracking_data?.shipment_track?.[0];

    return {
      status: trackData?.current_status || "In Transit",
      currentLocation: trackData?.destination || undefined,
      estimatedDelivery: trackData?.edd ? new Date(trackData.edd) : undefined,
      events: (data.tracking_data?.shipment_track_activities || []).map((act: any) => ({
        activity: act.activity,
        location: act.location,
        date: new Date(act.date),
      })),
    };
  }
}

export const shiprocketProvider = new ShiprocketProvider();
