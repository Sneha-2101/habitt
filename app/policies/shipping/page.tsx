import Link from "next/link";
import { getSettings } from "@/lib/settings";
import { formatINR } from "@/lib/money";
import { getSessionUser } from "@/lib/sessions";

export const dynamic = "force-dynamic";

export default async function ShippingPolicyPage() {
  const [settings, sessionUser] = await Promise.all([
    getSettings(),
    getSessionUser().catch(() => null),
  ]);
  const isStaff = sessionUser?.role === "STAFF" || sessionUser?.role === "OWNER";
  const freeThresholdStr = formatINR(settings.freeShippingThreshold);
  const shippingFeeStr = formatINR(settings.shippingFee);

  return (
    <main className="max-w-3xl mx-auto px-4 sm:px-7 py-12 space-y-6">
      <div>
        <h1 className="font-display text-3xl text-ink font-medium mb-2">Shipping & Delivery Guidelines</h1>
        <p className="text-xs text-stone-dark font-mono uppercase tracking-wider">Last updated: September 2026</p>
      </div>

      <div className="text-xs text-[#4B473F] leading-relaxed space-y-4 pt-4 border-t border-stone/50">
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-ink">1. Shipping Charges & Free Shipping</h3>
          <p>
            {settings.freeShippingOnPrepaid && (
              <span>We offer <strong>Free Shipping</strong> on all prepaid orders (UPI, Cards, Netbanking). </span>
            )}
            Orders above {freeThresholdStr} qualify for free standard shipping. For orders under {freeThresholdStr}, a flat shipping fee of {shippingFeeStr} is applied at checkout.
          </p>
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-ink">2. Delivery Timelines</h3>
          <p>
            {settings.businessState
              ? `All packages are dispatched from our primary facility in ${settings.businessState} and delivered across India within ${settings.maxDeliveryDays} days of dispatch.`
              : `All packages are dispatched from our primary facility and delivered across India within ${settings.maxDeliveryDays} days of dispatch.`}
          </p>
          {!settings.businessState && isStaff && (
            <div className="p-2.5 bg-amber-50 border border-amber-200 text-amber-900 text-[11.5px] rounded-xs">
              Set business state in <Link href="/admin/gst" className="underline font-medium">/admin/gst</Link>
            </div>
          )}
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>Standard Delivery:</strong> Up to {settings.maxDeliveryDays} days post-dispatch.</li>
          </ul>
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-ink">3. Tracking & Notifications</h3>
          <p>
            As soon as your package is dispatched, you will receive notification containing your courier partner details and tracking AWB number.
          </p>
        </section>
      </div>
    </main>
  );
}
