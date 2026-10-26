import { getSettings } from "@/lib/settings";
import { formatINR } from "@/lib/money";

export default async function ShippingPolicyPage() {
  const settings = await getSettings();
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
          <h3 className="text-sm font-semibold text-ink">1. Processing Time</h3>
          <p>
            All orders are processed and handed over to courier partners within 24–48 hours on business days (Monday to Saturday). Orders placed on Sundays or public holidays are processed the following business day.
          </p>
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-ink">2. Shipping Charges & Free Shipping</h3>
          <p>
            We offer <strong>Free Standard Shipping</strong> on all orders above {freeThresholdStr}. For orders under {freeThresholdStr}, a flat shipping fee of {shippingFeeStr} is applied at checkout.
          </p>
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-ink">3. Delivery Timelines</h3>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>Metro Cities:</strong> 2 to 4 business days post-dispatch.</li>
            <li><strong>Rest of India:</strong> 4 to 6 business days post-dispatch.</li>
          </ul>
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-ink">4. Tracking & Notifications</h3>
          <p>
            As soon as your package is dispatched, you will receive an email and SMS notification containing your courier partner details (e.g. Delhivery, Bluedart) and tracking AWB number.
          </p>
        </section>
      </div>
    </main>
  );
}
