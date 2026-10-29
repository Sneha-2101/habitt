import { Resend } from "resend";
import { getSettings } from "@/lib/settings";
import { escapeHtml } from "@/lib/escape-html";

const resendApiKey = process.env.RESEND_API_KEY;
const resend = resendApiKey ? new Resend(resendApiKey) : null;

async function getSenderInfo() {
  let settings;
  try {
    settings = await getSettings();
  } catch {
    settings = {
      businessName: "Habitt",
      orderSenderEmail: "",
      supportEmail: "",
    };
  }

  const businessName = settings.businessName || "Habitt";
  const from = process.env.RESEND_FROM_EMAIL || (settings.orderSenderEmail ? `${businessName} <${settings.orderSenderEmail}>` : `${businessName} <onboarding@resend.dev>`);
  const replyTo = settings.supportEmail || undefined;

  return { from, replyTo, businessName };
}

export async function sendEmailOtp(
  email: string,
  code: string
): Promise<{ success: boolean; error?: string }> {
  if (!resend) {
    console.log(`[DEV MODE] Email OTP for ${email}: ${code} (RESEND_API_KEY not configured)`);
    return { success: true };
  }

  try {
    const { from, replyTo, businessName } = await getSenderInfo();

    const htmlContent = `
      <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto; padding: 24px; color: #111; background-color: #faf9f6;">
        <h2 style="font-size: 20px; font-weight: 600; margin-bottom: 8px; color: #111;">Verification Code</h2>
        <p style="color: #555; margin-bottom: 20px; font-size: 14px;">Use the following 6-digit verification code to sign in to your ${escapeHtml(businessName)} account:</p>

        <div style="background-color: #ffffff; border: 1px solid #e5e5e5; border-radius: 8px; padding: 20px; text-align: center; margin-bottom: 24px;">
          <span style="font-family: monospace; font-size: 28px; font-weight: 700; letter-spacing: 4px; color: #111;">${escapeHtml(code)}</span>
          <p style="font-size: 12px; color: #888; margin: 10px 0 0 0;">This code expires in 5 minutes.</p>
        </div>

        <p style="font-size: 12px; color: #888; text-align: center; margin-top: 24px;">
          If you did not request this verification code, please ignore this email.
        </p>
      </div>
    `;

    const response = await resend.emails.send({
      from,
      replyTo,
      to: email,
      subject: `${code} is your ${businessName} verification code`,
      html: htmlContent,
    });

    console.log(`[Email OTP] Sent verification code to ${email}:`, response);
    return { success: true };
  } catch (error) {
    console.error(`[Email OTP Error] Failed to send code to ${email}:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to send email OTP",
    };
  }
}
