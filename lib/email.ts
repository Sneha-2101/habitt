import { Resend } from "resend";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";

const resendApiKey = process.env.RESEND_API_KEY;
const resend = resendApiKey ? new Resend(resendApiKey) : null;

async function getFromEmail() {
  if (process.env.RESEND_FROM_EMAIL) return process.env.RESEND_FROM_EMAIL;
  try {
    const settings = await getSettings();
    if (settings.orderSenderEmail) return `Habitt <${settings.orderSenderEmail}>`;
  } catch (err) {
    // fallback
  }
  return "Habitt <onboarding@resend.dev>";
}

export async function sendOrderConfirmationEmail(orderId: string) {
  if (!resend) {
    console.log(`[Email] RESEND_API_KEY is not set. Skipping order confirmation email for order ${orderId}.`);
    return { success: false, reason: "No API Key" };
  }

  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true, user: true },
    });

    if (!order) {
      console.error(`[Email] Order not found: ${orderId}`);
      return { success: false, reason: "Order not found" };
    }

    const recipientEmail = order.customerEmail || order.user?.email;
    if (!recipientEmail) {
      console.error(`[Email] No recipient email for order: ${orderId}`);
      return { success: false, reason: "No recipient email" };
    }

    const address = typeof order.shippingAddress === "object" && order.shippingAddress !== null
      ? (order.shippingAddress as Record<string, any>)
      : {};

    const formattedAddress = [
      address.addressLine1 || address.street,
      address.addressLine2,
      address.city,
      address.state,
      address.pincode || address.postalCode,
    ].filter(Boolean).join(", ");

    const itemsHtml = order.items
      .map(
        (item) => `
        <tr>
          <td style="padding: 8px; border-bottom: 1px solid #eee;">${item.name} (${item.size})</td>
          <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: center;">${item.qty}</td>
          <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: right;">₹${((item.unitPrice * item.qty) / 100).toFixed(2)}</td>
        </tr>
      `
      )
      .join("");

    const fromEmail = await getFromEmail();

    const htmlContent = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #111; background-color: #faf9f6;">
        <h2 style="font-size: 24px; font-weight: 600; margin-bottom: 8px;">Order Confirmation</h2>
        <p style="color: #666; margin-bottom: 24px;">Thank you for your purchase with Habitt!</p>

        <div style="background-color: #ffffff; border: 1px solid #e5e5e5; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
          <p style="margin: 0 0 8px 0;"><strong>Order ID:</strong> #${order.displayId}</p>
          <p style="margin: 0 0 8px 0;"><strong>Customer:</strong> ${order.customerName}</p>
          <p style="margin: 0 0 8px 0;"><strong>Shipping Address:</strong> ${formattedAddress || "Standard Shipping"}</p>
        </div>

        <table style="width: 100%; border-collapse: collapse; background-color: #ffffff; border: 1px solid #e5e5e5; border-radius: 8px; margin-bottom: 24px;">
          <thead>
            <tr style="background-color: #f0ede6; text-align: left;">
              <th style="padding: 10px; border-bottom: 1px solid #ddd;">Item</th>
              <th style="padding: 10px; border-bottom: 1px solid #ddd; text-align: center;">Qty</th>
              <th style="padding: 10px; border-bottom: 1px solid #ddd; text-align: right;">Price</th>
            </tr>
          </thead>
          <tbody>
            ${itemsHtml}
          </tbody>
        </table>

        <div style="text-align: right; background-color: #ffffff; border: 1px solid #e5e5e5; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
          <p style="margin: 0 0 4px 0; color: #666;">Subtotal: ₹${(order.subtotal / 100).toFixed(2)}</p>
          <p style="margin: 0 0 8px 0; color: #666;">Shipping: ${order.shippingFee === 0 ? "Free" : `₹${(order.shippingFee / 100).toFixed(2)}`}</p>
          <h3 style="margin: 0; font-size: 18px; font-weight: 700; color: #111;">Total Paid: ₹${(order.total / 100).toFixed(2)}</h3>
        </div>

        <p style="font-size: 12px; color: #888; text-align: center; margin-top: 32px;">
          Habitt Apparel — Minimalist Essentials
        </p>
      </div>
    `;

    const response = await resend.emails.send({
      from: fromEmail,
      to: recipientEmail,
      subject: `Order Confirmation #${order.displayId} — Habitt`,
      html: htmlContent,
    });

    console.log(`[Email] Confirmation sent for order ${order.displayId} to ${recipientEmail}:`, response);
    return { success: true, data: response };
  } catch (error) {
    console.error(`[Email] Failed to send order confirmation email for ${orderId}:`, error);
    return { success: false, error };
  }
}

export async function sendShipmentNotificationEmail(orderId: string) {
  if (!resend) {
    console.log(`[Email] RESEND_API_KEY is not set. Skipping shipment notification email for order ${orderId}.`);
    return { success: false, reason: "No API Key" };
  }

  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { user: true },
    });

    if (!order) {
      console.error(`[Email] Order not found: ${orderId}`);
      return { success: false, reason: "Order not found" };
    }

    const recipientEmail = order.customerEmail || order.user?.email;
    if (!recipientEmail) {
      console.error(`[Email] No recipient email for order: ${orderId}`);
      return { success: false, reason: "No recipient email" };
    }

    const fromEmail = await getFromEmail();

    const htmlContent = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #111; background-color: #faf9f6;">
        <h2 style="font-size: 24px; font-weight: 600; margin-bottom: 8px;">Your Order Has Shipped!</h2>
        <p style="color: #666; margin-bottom: 24px;">Great news! Your package for order #${order.displayId} is on its way.</p>

        <div style="background-color: #ffffff; border: 1px solid #e5e5e5; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
          <p style="margin: 0 0 8px 0;"><strong>Courier Partner:</strong> ${order.courierName || "Express Courier"}</p>
          <p style="margin: 0 0 8px 0;"><strong>Tracking / AWB Number:</strong> ${order.awbNumber || "Pending"}</p>
          ${
            order.trackingUrl
              ? `<p style="margin: 16px 0 0 0;"><a href="${order.trackingUrl}" target="_blank" style="background-color: #111; color: #fff; text-decoration: none; padding: 10px 18px; border-radius: 4px; display: inline-block; font-size: 13px; font-weight: 500;">Track Shipment →</a></p>`
              : ""
          }
        </div>

        <p style="font-size: 12px; color: #888; text-align: center; margin-top: 32px;">
          Habitt Apparel — Minimalist Essentials
        </p>
      </div>
    `;

    const response = await resend.emails.send({
      from: fromEmail,
      to: recipientEmail,
      subject: `Your order #${order.displayId} has shipped! — Habitt`,
      html: htmlContent,
    });

    console.log(`[Email] Shipment notification sent for order ${order.displayId} to ${recipientEmail}:`, response);
    return { success: true, data: response };
  } catch (error) {
    console.error(`[Email] Failed to send shipment notification email for ${orderId}:`, error);
    return { success: false, error };
  }
}

export async function sendCancellationEmail(orderId: string) {
  if (!resend) {
    console.log(`[Email] RESEND_API_KEY is not set. Skipping cancellation email for order ${orderId}.`);
    return { success: false, reason: "No API Key" };
  }

  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { user: true },
    });

    if (!order) {
      console.error(`[Email] Order not found: ${orderId}`);
      return { success: false, reason: "Order not found" };
    }

    const recipientEmail = order.customerEmail || order.user?.email;
    if (!recipientEmail) {
      console.error(`[Email] No recipient email for order: ${orderId}`);
      return { success: false, reason: "No recipient email" };
    }

    const fromEmail = await getFromEmail();
    const isRefunded = !!order.refundAmount && order.refundAmount > 0;

    const htmlContent = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #111; background-color: #faf9f6;">
        <h2 style="font-size: 24px; font-weight: 600; margin-bottom: 8px;">Order Cancellation Confirmed</h2>
        <p style="color: #666; margin-bottom: 24px;">Your order #${order.displayId} has been cancelled.</p>

        <div style="background-color: #ffffff; border: 1px solid #e5e5e5; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
          <p style="margin: 0 0 8px 0;"><strong>Order ID:</strong> #${order.displayId}</p>
          <p style="margin: 0 0 8px 0;"><strong>Cancellation Reason:</strong> ${order.cancellationReason || "Requested by customer"}</p>
          ${
            isRefunded
              ? `<p style="margin: 8px 0 0 0; color: #15803d;"><strong>Refund Processed:</strong> ₹${((order.refundAmount || 0) / 100).toFixed(2)} (Ref: ${order.razorpayRefundId || "N/A"})</p>
                 <p style="margin: 4px 0 0 0; font-size: 12px; color: #666;">The refund will reflect in your original payment method in 5-7 business days.</p>`
              : `<p style="margin: 8px 0 0 0; color: #666;">No payment was captured for this order.</p>`
          }
        </div>

        <p style="font-size: 12px; color: #888; text-align: center; margin-top: 32px;">
          Habitt Apparel — Minimalist Essentials
        </p>
      </div>
    `;

    const response = await resend.emails.send({
      from: fromEmail,
      to: recipientEmail,
      subject: `Order #${order.displayId} Cancelled — Habitt`,
      html: htmlContent,
    });

    console.log(`[Email] Cancellation email sent for order ${order.displayId} to ${recipientEmail}:`, response);
    return { success: true, data: response };
  } catch (error) {
    console.error(`[Email] Failed to send cancellation email for ${orderId}:`, error);
    return { success: false, error };
  }
}

export async function sendDeliveredEmail(orderId: string) {
  if (!resend) {
    console.log(`[Email] RESEND_API_KEY is not set. Skipping delivery notification email for order ${orderId}.`);
    return { success: false, reason: "No API Key" };
  }

  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { user: true },
    });

    if (!order) {
      console.error(`[Email] Order not found: ${orderId}`);
      return { success: false, reason: "Order not found" };
    }

    const recipientEmail = order.customerEmail || order.user?.email;
    if (!recipientEmail) {
      console.error(`[Email] No recipient email for order: ${orderId}`);
      return { success: false, reason: "No recipient email" };
    }

    const fromEmail = await getFromEmail();

    const htmlContent = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #111; background-color: #faf9f6;">
        <h2 style="font-size: 24px; font-weight: 600; margin-bottom: 8px;">Your Order Has Been Delivered! 🎉</h2>
        <p style="color: #666; margin-bottom: 24px;">Your order #${order.displayId} has been successfully delivered. We hope you love your new Habitt pieces!</p>

        <div style="background-color: #ffffff; border: 1px solid #e5e5e5; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
          <p style="margin: 0 0 8px 0;"><strong>Order ID:</strong> #${order.displayId}</p>
          <p style="margin: 0 0 8px 0;"><strong>Delivery Date:</strong> ${order.deliveredAt ? new Date(order.deliveredAt).toLocaleDateString("en-IN") : new Date().toLocaleDateString("en-IN")}</p>
          <p style="margin: 16px 0 0 0;"><a href="${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/account" style="background-color: #111; color: #fff; text-decoration: none; padding: 10px 18px; border-radius: 4px; display: inline-block; font-size: 13px; font-weight: 500;">View Order & Review →</a></p>
        </div>

        <p style="font-size: 12px; color: #888; text-align: center; margin-top: 32px;">
          Habitt Apparel — Minimalist Essentials
        </p>
      </div>
    `;

    const response = await resend.emails.send({
      from: fromEmail,
      to: recipientEmail,
      subject: `Order #${order.displayId} Delivered! — Habitt`,
      html: htmlContent,
    });

    console.log(`[Email] Delivery email sent for order ${order.displayId} to ${recipientEmail}:`, response);
    return { success: true, data: response };
  } catch (error) {
    console.error(`[Email] Failed to send delivery notification email for ${orderId}:`, error);
    return { success: false, error };
  }
}

export async function sendBackInStockEmail(email: string, productName: string, productSlug: string, size: string) {
  if (!resend) {
    console.log(`[Email] RESEND_API_KEY is not set. Skipping back in stock email for ${email}.`);
    return { success: false, reason: "No API Key" };
  }

  try {
    const fromEmail = await getFromEmail();
    const appUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";

    const htmlContent = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #111; background-color: #faf9f6;">
        <h2 style="font-size: 24px; font-weight: 600; margin-bottom: 8px;">Back in Stock! 🎉</h2>
        <p style="color: #666; margin-bottom: 24px;">Great news! <strong>${productName}</strong> (Size: ${size}) is now back in stock.</p>
        <p style="margin-bottom: 24px;">
          <a href="${appUrl}/product/${productSlug}" style="background-color: #111; color: #fff; text-decoration: none; padding: 12px 24px; border-radius: 4px; display: inline-block; font-size: 13px; font-weight: 500;">
            Shop ${productName} Now →
          </a>
        </p>
        <p style="font-size: 12px; color: #888; text-align: center; margin-top: 32px;">Habitt Apparel — Minimalist Essentials</p>
      </div>
    `;

    const response = await resend.emails.send({
      from: fromEmail,
      to: email,
      subject: `${productName} is back in stock! — Habitt`,
      html: htmlContent,
    });

    console.log(`[Email] Back-in-stock email sent to ${email} for ${productName}:`, response);
    return { success: true, data: response };
  } catch (error) {
    console.error(`[Email] Failed to send back-in-stock email to ${email}:`, error);
    return { success: false, error };
  }
}

export async function sendNewsletterWelcomeEmail(email: string, couponCodeInput?: string) {
  if (!resend) {
    console.log(`[Email] RESEND_API_KEY is not set. Skipping newsletter welcome email for ${email}.`);
    return { success: false, reason: "No API Key" };
  }

  try {
    const settings = await getSettings();
    const couponCode = couponCodeInput || settings.welcomeCouponCode;
    const couponPercent = settings.welcomeCouponPercent;
    const fromEmail = await getFromEmail();
    const appUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";

    const htmlContent = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #111; background-color: #faf9f6;">
        <h2 style="font-size: 24px; font-weight: 600; margin-bottom: 8px;">Welcome to ${settings.businessName}! 🌿</h2>
        <p style="color: #666; margin-bottom: 20px;">Thank you for joining our newsletter. Here is your ${couponPercent}% discount coupon for your first purchase:</p>

        <div style="background-color: #ffffff; border: 1px dashed #111; border-radius: 8px; padding: 20px; text-align: center; margin-bottom: 24px;">
          <span style="font-family: monospace; font-size: 22px; font-weight: 700; letter-spacing: 2px; color: #111;">${couponCode}</span>
          <p style="font-size: 12px; color: #666; margin: 8px 0 0 0;">Use at checkout for ${couponPercent}% off your entire first order.</p>
        </div>

        <p style="text-align: center;">
          <a href="${appUrl}/shop" style="background-color: #111; color: #fff; text-decoration: none; padding: 12px 24px; border-radius: 4px; display: inline-block; font-size: 13px; font-weight: 500;">
            Explore the Collection →
          </a>
        </p>

        <p style="font-size: 12px; color: #888; text-align: center; margin-top: 32px;">${settings.businessName} — ${settings.businessTagline}</p>
      </div>
    `;

    const response = await resend.emails.send({
      from: fromEmail,
      to: email,
      subject: `Welcome to ${settings.businessName} — Here is your ${couponPercent}% off code`,
      html: htmlContent,
    });

    console.log(`[Email] Newsletter welcome email sent to ${email}:`, response);
    return { success: true, data: response };
  } catch (error) {
    console.error(`[Email] Failed to send newsletter welcome email to ${email}:`, error);
    return { success: false, error };
  }
}

export async function sendAbandonedCartEmail(email: string, customerName: string, displayId: string) {
  if (!resend) {
    console.log(`[Email] RESEND_API_KEY is not set. Skipping abandoned cart email for order ${displayId}.`);
    return { success: false, reason: "No API Key" };
  }

  try {
    const fromEmail = process.env.RESEND_FROM_EMAIL || "Habitt <onboarding@resend.dev>";
    const appUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";

    const htmlContent = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #111; background-color: #faf9f6;">
        <h2 style="font-size: 24px; font-weight: 600; margin-bottom: 8px;">Still thinking about it?</h2>
        <p style="color: #666; margin-bottom: 24px;">Hi ${customerName}, we noticed you left items in your cart for order #${displayId}. Your selection is still saved for you.</p>

        <p style="margin-bottom: 24px;">
          <a href="${appUrl}/checkout" style="background-color: #111; color: #fff; text-decoration: none; padding: 12px 24px; border-radius: 4px; display: inline-block; font-size: 13px; font-weight: 500;">
            Complete Your Purchase →
          </a>
        </p>

        <p style="font-size: 12px; color: #888; text-align: center; margin-top: 32px;">Habitt Apparel — Minimalist Essentials</p>
      </div>
    `;

    const response = await resend.emails.send({
      from: fromEmail,
      to: email,
      subject: `Did you forget something? — Habitt`,
      html: htmlContent,
    });

    console.log(`[Email] Abandoned cart email sent for order ${displayId} to ${email}:`, response);
    return { success: true, data: response };
  } catch (error) {
    console.error(`[Email] Failed to send abandoned cart email to ${email}:`, error);
    return { success: false, error };
  }
}

export async function sendReviewRequestEmail(orderId: string) {
  if (!resend) {
    console.log(`[Email] RESEND_API_KEY is not set. Skipping review request email for order ${orderId}.`);
    return { success: false, reason: "No API Key" };
  }

  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true, user: true },
    });

    if (!order) return { success: false, reason: "Order not found" };

    const recipientEmail = order.customerEmail || order.user?.email;
    if (!recipientEmail) return { success: false, reason: "No recipient email" };

    const fromEmail = process.env.RESEND_FROM_EMAIL || "Habitt <onboarding@resend.dev>";
    const appUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";

    const itemLinks = order.items
      .map(
        (item) => `
        <li style="margin-bottom: 8px;">
          <strong>${item.name}</strong> — 
          <a href="${appUrl}/product/${item.productId}" style="color: #111; font-weight: 500;">Write a review →</a>
        </li>
      `
      )
      .join("");

    const htmlContent = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #111; background-color: #faf9f6;">
        <h2 style="font-size: 24px; font-weight: 600; margin-bottom: 8px;">How are your new Habitt pieces?</h2>
        <p style="color: #666; margin-bottom: 24px;">Hi ${order.customerName}, we hope you are enjoying order #${order.displayId}. We'd love to hear your feedback!</p>

        <div style="background-color: #ffffff; border: 1px solid #e5e5e5; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
          <ul style="padding-left: 20px; margin: 0;">
            ${itemLinks}
          </ul>
        </div>

        <p style="font-size: 12px; color: #888; text-align: center; margin-top: 32px;">Habitt Apparel — Minimalist Essentials</p>
      </div>
    `;

    const response = await resend.emails.send({
      from: fromEmail,
      to: recipientEmail,
      subject: `How are your new pieces? Leave a review — Habitt`,
      html: htmlContent,
    });

    console.log(`[Email] Review request email sent for order ${order.displayId} to ${recipientEmail}:`, response);
    return { success: true, data: response };
  } catch (error) {
    console.error(`[Email] Failed to send review request email for ${orderId}:`, error);
    return { success: false, error };
  }
}

export async function sendBirthdayDiscountEmail(email: string, userName: string, couponCode: string, percent: number) {
  if (!resend) {
    console.log(`[Email] RESEND_API_KEY is not set. Skipping birthday email for ${email}. Code: ${couponCode}`);
    return { success: false, reason: "No API Key" };
  }

  try {
    const fromEmail = await getFromEmail();
    const appUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";

    const htmlContent = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #111; background-color: #faf9f6;">
        <h2 style="font-size: 24px; font-weight: 600; margin-bottom: 8px;">Happy Birthday, ${userName}! 🎂</h2>
        <p style="color: #666; margin-bottom: 24px;">To celebrate your special day, here is an exclusive ${percent}% discount on your next Habitt purchase!</p>

        <div style="background-color: #ffffff; border: 1px dashed #111; border-radius: 8px; padding: 20px; text-align: center; margin-bottom: 24px;">
          <span style="font-family: monospace; font-size: 22px; font-weight: 700; letter-spacing: 2px; color: #111;">${couponCode}</span>
          <p style="font-size: 12px; color: #666; margin: 8px 0 0 0;">Valid for 30 days. Single use per customer.</p>
        </div>

        <p style="text-align: center;">
          <a href="${appUrl}/shop" style="background-color: #111; color: #fff; text-decoration: none; padding: 12px 24px; border-radius: 4px; display: inline-block; font-size: 13px; font-weight: 500;">
            Treat Yourself Today →
          </a>
        </p>

        <p style="font-size: 12px; color: #888; text-align: center; margin-top: 32px;">Habitt Apparel — Minimalist Essentials</p>
      </div>
    `;

    const response = await resend.emails.send({
      from: fromEmail,
      to: email,
      subject: `Happy Birthday! Here is ${percent}% off your next purchase — Habitt`,
      html: htmlContent,
    });

    console.log(`[Email] Birthday discount email sent to ${email} (${couponCode}):`, response);
    return { success: true, data: response };
  } catch (error) {
    console.error(`[Email] Failed to send birthday discount email to ${email}:`, error);
    return { success: false, error };
  }
}

export async function sendStoreCreditIssuedEmail(email: string, userName: string, amountPaise: number, reason: string) {
  if (!resend) {
    console.log(`[Email] RESEND_API_KEY is not set. Skipping store credit email for ${email}.`);
    return { success: false, reason: "No API Key" };
  }

  try {
    const fromEmail = await getFromEmail();
    const appUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
    const amountRupees = (amountPaise / 100).toFixed(2);

    const htmlContent = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #111; background-color: #faf9f6;">
        <h2 style="font-size: 24px; font-weight: 600; margin-bottom: 8px;">Store Credit Added 💳</h2>
        <p style="color: #666; margin-bottom: 24px;">Hi ${userName}, ₹${amountRupees} store credit has been added to your Habitt account.</p>

        <div style="background-color: #ffffff; border: 1px solid #e5e5e5; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
          <p style="margin: 0 0 8px 0;"><strong>Credit Added:</strong> ₹${amountRupees}</p>
          <p style="margin: 0 0 8px 0;"><strong>Reason:</strong> ${reason}</p>
          <p style="margin: 0; font-size: 12px; color: #666;">Store credit never expires and will automatically apply at checkout.</p>
        </div>

        <p style="text-align: center;">
          <a href="${appUrl}/account" style="background-color: #111; color: #fff; text-decoration: none; padding: 12px 24px; border-radius: 4px; display: inline-block; font-size: 13px; font-weight: 500;">
            View Account Ledger →
          </a>
        </p>

        <p style="font-size: 12px; color: #888; text-align: center; margin-top: 32px;">Habitt Apparel — Minimalist Essentials</p>
      </div>
    `;

    const response = await resend.emails.send({
      from: fromEmail,
      to: email,
      subject: `₹${amountRupees} store credit added to your account — Habitt`,
      html: htmlContent,
    });

    console.log(`[Email] Store credit notification email sent to ${email}:`, response);
    return { success: true, data: response };
  } catch (error) {
    console.error(`[Email] Failed to send store credit notification email to ${email}:`, error);
    return { success: false, error };
  }
}
