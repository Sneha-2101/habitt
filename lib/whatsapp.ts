/**
 * Direct Meta WhatsApp Cloud API Integration (No BSP required).
 *
 * Calls Meta's Graph API directly to dispatch authentication OTPs.
 * If META_WHATSAPP_TOKEN or META_WHATSAPP_PHONE_NUMBER_ID is missing/unset,
 * falls back to logging the OTP code prominently in the server console for dev testing.
 */

export function graphVersion(): string {
  const version = process.env.META_GRAPH_VERSION?.trim();
  if (version) {
    return version;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("META_GRAPH_VERSION is required in production environment");
  }
  return "v20.0";
}

export async function sendWhatsappOtp(
  phone: string,
  code: string
): Promise<{ success: boolean; devMode?: boolean; error?: string }> {
  const token = process.env.META_WHATSAPP_TOKEN?.trim();
  const phoneNumberId = process.env.META_WHATSAPP_PHONE_NUMBER_ID?.trim();

  // If Meta credentials are not configured, log to server console for testing
  if (!token || !phoneNumberId || token === "YOUR_META_WHATSAPP_TOKEN" || phoneNumberId === "YOUR_META_PHONE_NUMBER_ID") {
    console.log("==========================================================");
    console.log(`[DEV MODE] WhatsApp OTP for ${phone}: ${code}`);
    console.log("==========================================================");
    return { success: true, devMode: true };
  }

  // Format phone number to numeric digits (Meta E.164 without leading '+')
  const recipient = phone.replace(/\D/g, "");

  const version = graphVersion();

  try {
    const url = `https://graph.facebook.com/${version}/${phoneNumberId}/messages`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: recipient,
        type: "template",
        template: {
          name: "authentication_code",
          language: { code: "en_US" },
          components: [
            {
              type: "body",
              parameters: [{ type: "text", text: code }],
            },
            {
              type: "button",
              sub_type: "url",
              index: "0",
              parameters: [{ type: "text", text: code }],
            },
          ],
        },
      }),
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      console.error("[WhatsApp Cloud API Error]:", errorData);
      return {
        success: false,
        error: errorData?.error?.message || `WhatsApp API error: ${res.status}`,
      };
    }

    return { success: true };
  } catch (err) {
    console.error("[WhatsApp Send Exception]:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to dispatch WhatsApp message",
    };
  }
}
