// VERIFY AGAINST CURRENT SHIPROCKET API DOCS BEFORE GO-LIVE
/**
 * Shiprocket API Integration Client & Provider Implementation.
 *
 * All Shiprocket endpoint paths, request structures, and webhook payloads:
 * - Auth login: POST /v1/external/auth/login
 *     Request: { email, password }
 *     Response: { token: string }
 * - Create adhoc order: POST /v1/external/orders/create/adhoc
 *     Request: {
 *       order_id, order_date, pickup_location,
 *       billing_customer_name, billing_address, billing_city, billing_pincode, billing_state, billing_country, billing_email, billing_phone,
 *       shipping_is_billing, order_items: [{ name, sku, units, selling_price }],
 *       payment_method, sub_total, length, breadth, height, weight
 *     }
 *     Response: { order_id, shipment_id, status, status_code, onboarding_completed_now }
 * - Generate AWB: POST /v1/external/courier/assign/awb
 *     Request: { shipment_id, courier_id? }
 *     Response: { response: { data: { awb_code, courier_name, applied_weight } } }
 * - Request pickup: POST /v1/external/courier/generate/pickup
 *     Request: { shipment_id: [number] }
 *     Response: { response: { pickup_status, response: { pickup_scheduled_date } } }
 * - Tracking by AWB: GET /v1/external/courier/track/awb/:awb
 *     Response: { tracking_data: { shipment_track: [{ current_status, edd, destination }], shipment_track_activities: [{ activity, location, date, sr-status }] } }
 * - Cancel shipment: POST /v1/external/orders/cancel/shipment/awbs
 *     Request: { awbs: [string] }
 *     Response: { message }
 * - Webhook payload schema:
 *     Headers: x-api-key or HTTP_X_API_KEY
 *     Body: { awb, current_status, current_timestamp, courier_name, location, order_id, shipment_id }
 */

import { getSettings } from "@/lib/settings";
import type {
  ShippingProvider,
  OrderWithItemsAndVariants,
  CreateShipmentResult,
  AssignAwbResult,
  TrackingStatusResult,
} from "./provider";
import { manualShippingProvider } from "./manual";

const SHIPROCKET_BASE_URL = "https://apiv2.shiprocket.in/v1/external";

interface ShiprocketCreateResponse {
  order_id?: number | string;
  id?: number | string;
  shipment_id?: number | string;
  awb_code?: string;
  courier_name?: string;
}

interface ShiprocketAwbResponse {
  response?: {
    data?: {
      awb_code?: string;
      courier_name?: string;
      label_url?: string;
    };
  };
  awb_code?: string;
  courier_name?: string;
}

interface ShiprocketTrackResponse {
  tracking_data?: {
    shipment_track?: Array<{
      current_status?: string;
      destination?: string;
      edd?: string;
      shipment_track_activities?: Array<{
        activity?: string;
        location?: string;
        date?: string;
        "sr-status"?: string;
      }>;
    }>;
    shipment_track_activities?: Array<{
      activity?: string;
      location?: string;
      date?: string;
      "sr-status"?: string;
    }>;
  };
}

export class ShiprocketShippingProvider implements ShippingProvider {
  readonly name = "SHIPROCKET" as const;

  private token: string | null = null;
  private tokenExpiresAt: number = 0;

  private getCredentials() {
    const email = process.env.SHIPROCKET_EMAIL?.trim();
    const password = process.env.SHIPROCKET_PASSWORD?.trim();
    if (!email || !password) {
      throw new Error("Shiprocket credentials are not configured");
    }
    return { email, password };
  }

  private async getAuthToken(forceRefresh = false): Promise<string> {
    if (!forceRefresh && this.token && Date.now() < this.tokenExpiresAt) {
      return this.token;
    }

    const { email, password } = this.getCredentials();

    try {
      const response = await fetch(`${SHIPROCKET_BASE_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        throw new Error(`Shiprocket auth failed: HTTP ${response.status}`);
      }

      const data = await response.json();
      if (!data?.token) {
        throw new Error("Shiprocket auth failed: Missing token in response");
      }

      this.token = String(data.token);
      // Valid for ~10 days; expire in memory after 9 days
      this.tokenExpiresAt = Date.now() + 9 * 24 * 60 * 60 * 1000;
      return this.token;
    } catch (err: unknown) {
      this.token = null;
      this.tokenExpiresAt = 0;
      throw new Error(
        `Failed to authenticate with Shiprocket: ${err instanceof Error ? err.message : "Network error"}`
      );
    }
  }

  private async request<T = Record<string, unknown>>(
    path: string,
    options: RequestInit = {},
    retryOn401 = true
  ): Promise<T> {
    const token = await this.getAuthToken();
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    };

    try {
      const response = await fetch(`${SHIPROCKET_BASE_URL}${path}`, {
        ...options,
        headers,
        signal: AbortSignal.timeout(10000),
      });

      if (response.status === 401 && retryOn401) {
        // Token expired; force refresh token once
        const freshToken = await this.getAuthToken(true);
        const retryResponse = await fetch(`${SHIPROCKET_BASE_URL}${path}`, {
          ...options,
          headers: {
            ...headers,
            Authorization: `Bearer ${freshToken}`,
          },
          signal: AbortSignal.timeout(10000),
        });

        if (!retryResponse.ok) {
          throw new Error(`Shiprocket request failed: HTTP ${retryResponse.status}`);
        }
        return (await retryResponse.json()) as T;
      }

      if (!response.ok) {
        let errorMsg = `Shiprocket request failed: HTTP ${response.status}`;
        try {
          const errData = await response.json();
          if (errData?.message) errorMsg = `Shiprocket: ${errData.message}`;
        } catch {
          // ignore
        }
        throw new Error(errorMsg);
      }

      return (await response.json()) as T;
    } catch (err: unknown) {
      throw new Error(
        `Shiprocket error: ${err instanceof Error ? err.message : "Service unavailable"}`
      );
    }
  }

  async createShipment(order: OrderWithItemsAndVariants): Promise<CreateShipmentResult> {
    const settings = await getSettings();
    const pickupLocation = settings.shiprocketPickupLocation || "Primary";

    const addr =
      typeof order.shippingAddress === "object" && order.shippingAddress !== null
        ? (order.shippingAddress as Record<string, unknown>)
        : {};

    const lineItems = order.items.map((item) => {
      // Use ProductVariant.sku when present, otherwise variantId (never productId-size)
      const sku = item.variant?.sku?.trim() || item.variantId;
      // Net paid value per item
      const netPaise = item.unitPrice * item.qty - (item.discountPaise || 0);
      const unitNetPaise = Math.max(100, Math.round(netPaise / item.qty));

      return {
        name: item.name,
        sku,
        units: item.qty,
        selling_price: (unitNetPaise / 100).toFixed(2),
      };
    });

    const isCod = order.paymentMethod === "COD";

    const payload = {
      order_id: order.displayId,
      order_date: order.createdAt.toISOString().replace("T", " ").substring(0, 19),
      pickup_location: pickupLocation,
      billing_customer_name: order.customerName,
      billing_last_name: "",
      billing_address: addr.line1 || addr.street || "Address",
      billing_address_2: addr.line2 || "",
      billing_city: addr.city || "City",
      billing_pincode: addr.pincode || addr.postalCode || "141001",
      billing_state: addr.state || "Punjab",
      billing_country: "India",
      billing_email: order.customerEmail || (typeof addr.email === "string" ? addr.email : ""),
      billing_phone: order.customerPhone || (typeof addr.phone === "string" ? addr.phone : ""),
      shipping_is_billing: true,
      order_items: lineItems,
      payment_method: isCod ? "COD" : "Prepaid",
      sub_total: (order.total / 100).toFixed(2),
      length: 15,
      breadth: 12,
      height: 5,
      weight: 0.5,
    };

    const res = await this.request<ShiprocketCreateResponse>("/orders/create/adhoc", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    const providerOrderId = String(res.order_id || res.id);
    const providerShipmentId = res.shipment_id ? String(res.shipment_id) : null;
    const awb = res.awb_code ? String(res.awb_code) : null;
    const courierName = res.courier_name || null;
    const trackingUrl = awb ? `https://shiprocket.co/tracking/${awb}` : null;

    return {
      providerOrderId,
      providerShipmentId,
      awb,
      courierName,
      trackingUrl,
    };
  }

  async assignAwb(providerShipmentId: string): Promise<AssignAwbResult> {
    const res = await this.request<ShiprocketAwbResponse>("/courier/assign/awb", {
      method: "POST",
      body: JSON.stringify({
        shipment_id: Number(providerShipmentId) || providerShipmentId,
      }),
    });

    const awbData = res?.response?.data;
    const awb = awbData?.awb_code || res?.awb_code;
    const courierName = awbData?.courier_name || res?.courier_name || "Shiprocket Partner";

    if (!awb) {
      throw new Error("Shiprocket did not return an AWB code");
    }

    return {
      awb: String(awb),
      courierName: String(courierName),
      trackingUrl: `https://shiprocket.co/tracking/${awb}`,
      labelUrl: awbData?.label_url || null,
    };
  }

  async schedulePickup(providerShipmentId: string): Promise<{ success: boolean }> {
    await this.request("/courier/generate/pickup", {
      method: "POST",
      body: JSON.stringify({
        shipment_id: [Number(providerShipmentId) || providerShipmentId],
      }),
    });

    return { success: true };
  }

  async track(awb: string): Promise<TrackingStatusResult> {
    const res = await this.request<ShiprocketTrackResponse>(`/courier/track/awb/${encodeURIComponent(awb)}`, {
      method: "GET",
    });

    const trackData = res?.tracking_data?.shipment_track?.[0];
    const rawStatus = trackData?.current_status || "IN_TRANSIT";
    const currentLocation = trackData?.destination || null;
    const edd = trackData?.edd ? new Date(trackData.edd) : null;

    const activities = Array.isArray(trackData?.shipment_track_activities)
      ? (trackData.shipment_track_activities as Record<string, unknown>[])
      : [];
    const events = activities.map((act) => ({
      activity: String(act.activity || ""),
      location: act.location ? String(act.location) : null,
      occurredAt: new Date(String(act.date)),
      rawStatus: String(act["sr-status"] || act.activity || rawStatus),
    }));

    return {
      rawStatus,
      currentLocation,
      estimatedDelivery: edd && !isNaN(edd.getTime()) ? edd : null,
      events,
    };
  }

  async cancel(providerShipmentId: string, awb?: string): Promise<{ success: boolean }> {
    if (awb) {
      await this.request("/orders/cancel/shipment/awbs", {
        method: "POST",
        body: JSON.stringify({ awbs: [awb] }),
      });
    }
    return { success: true };
  }
}

export const shiprocketShippingProvider = new ShiprocketShippingProvider();

/**
 * Returns true if Shiprocket is enabled in env AND all credentials exist.
 */
export function isShiprocketEnabled(): boolean {
  const isEnabled = process.env.SHIPROCKET_ENABLED === "true";
  const hasEmail = Boolean(process.env.SHIPROCKET_EMAIL?.trim());
  const hasPassword = Boolean(process.env.SHIPROCKET_PASSWORD?.trim());
  const hasWebhookToken = Boolean(process.env.SHIPROCKET_WEBHOOK_TOKEN?.trim());
  return isEnabled && hasEmail && hasPassword && hasWebhookToken;
}

/**
 * Provider selection helper:
 * Returns Shiprocket provider only when env SHIPROCKET_ENABLED=true AND
 * all credentials exist (SHIPROCKET_EMAIL, SHIPROCKET_PASSWORD, SHIPROCKET_WEBHOOK_TOKEN);
 * otherwise returns manual provider.
 */
export function getShippingProvider(): ShippingProvider {
  if (isShiprocketEnabled()) {
    return shiprocketShippingProvider;
  }

  return manualShippingProvider;
}
