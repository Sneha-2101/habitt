import Link from "next/link";

export default function SupportPage() {
  return (
    <main className="max-w-3xl mx-auto px-4 sm:px-7 py-12 space-y-8">
      <div>
        <h1 className="font-display text-3xl text-ink font-medium mb-2">Customer Support & FAQ</h1>
        <p className="text-sm text-stone-dark">
          We're here to help with sizing, order updates, shipping, or return requests.
        </p>
      </div>

      {/* Contact Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="p-5 border border-stone bg-white rounded-sm space-y-1">
          <h3 className="text-xs font-semibold text-stone-dark uppercase tracking-wider">Email Support</h3>
          <p className="text-sm font-medium text-ink">support@habitt.in</p>
          <p className="text-xs text-stone-dark">Mon–Sat • 10:00 AM – 7:00 PM IST</p>
        </div>
        <div className="p-5 border border-stone bg-white rounded-sm space-y-1">
          <h3 className="text-xs font-semibold text-stone-dark uppercase tracking-wider">WhatsApp Business</h3>
          <p className="text-sm font-medium text-ink">+91 98765 43210</p>
          <p className="text-xs text-stone-dark">Instant quick replies during business hours</p>
        </div>
      </div>

      {/* Frequently Asked Questions */}
      <section className="space-y-4 pt-4 border-t border-stone/50">
        <h2 className="font-display text-xl text-ink font-medium mb-4">Frequently Asked Questions</h2>

        <div className="space-y-3">
          <div className="p-4 border border-stone/60 bg-white rounded-sm space-y-1">
            <h4 className="text-sm font-semibold text-ink">How long does shipping take?</h4>
            <p className="text-xs text-stone-dark leading-relaxed">
              Standard orders are dispatched within 24-48 hours. Delivery usually takes 3 to 5 business days depending on your location.
            </p>
          </div>

          <div className="p-4 border border-stone/60 bg-white rounded-sm space-y-1">
            <h4 className="text-sm font-semibold text-ink">What is your return & exchange policy?</h4>
            <p className="text-xs text-stone-dark leading-relaxed">
              We offer a 7-day hassle-free return window for all unworn garments with original tags attached. You can initiate a return directly from your <Link href="/account" className="underline text-ink">Account page</Link>.
            </p>
          </div>

          <div className="p-4 border border-stone/60 bg-white rounded-sm space-y-1">
            <h4 className="text-sm font-semibold text-ink">How do I choose the right size?</h4>
            <p className="text-xs text-stone-dark leading-relaxed">
              Every product detail page includes a dedicated "Size guide" next to the size selector with exact garment measurements in inches.
            </p>
          </div>

          <div className="p-4 border border-stone/60 bg-white rounded-sm space-y-1">
            <h4 className="text-sm font-semibold text-ink">How do I track my order shipment?</h4>
            <p className="text-xs text-stone-dark leading-relaxed">
              Once dispatched, you will receive an email notification with courier details and tracking link. You can also view live status on your <Link href="/account" className="underline text-ink">Account page</Link>.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
