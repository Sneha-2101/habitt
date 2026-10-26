import Link from "next/link";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

export default async function ReturnsPolicyPage() {
  const settings = await getSettings();
  const days = settings.returnWindowDays || 7;

  return (
    <main className="max-w-3xl mx-auto px-4 sm:px-7 py-12 space-y-6">
      <div>
        <h1 className="font-display text-3xl text-ink font-medium mb-2">Returns & Refund Policy</h1>
        <p className="text-xs text-stone-dark font-mono uppercase tracking-wider">Last updated: September 2026</p>
      </div>

      <div className="prose text-xs text-[#4B473F] leading-relaxed space-y-4 pt-4 border-t border-stone/50">
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-ink">1. {days}-Day Easy Returns</h3>
          <p>
            We want you to be completely satisfied with your {settings.businessName} purchase. If a garment doesn't fit right or meet your expectations, you may request a return within {days} days of delivery.
          </p>
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-ink">2. Return Eligibility</h3>
          <p>To be eligible for a return and full refund:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>The item must be unworn, unwashed, and undamaged.</li>
            <li>Original tags and packaging must remain intact.</li>
            <li>Return requests must be submitted within {days} days of verified delivery.</li>
          </ul>
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-ink">3. Refund Processing</h3>
          <p>
            Once your return is approved by our staff team, refunds are processed automatically back to your original payment method via Razorpay (or recorded for COD orders). Refunds typically reflect in your account within 5–7 business days.
          </p>
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-ink">4. How to Initiate a Return</h3>
          <p>
            Sign in to your account, visit <Link href="/account" className="underline text-ink font-medium">My Orders</Link>, expand your delivered order, and click "Request Return / Refund".
          </p>
        </section>
      </div>
    </main>
  );
}
