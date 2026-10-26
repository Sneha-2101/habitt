export default function PrivacyPolicyPage() {
  return (
    <main className="max-w-3xl mx-auto px-4 sm:px-7 py-12 space-y-8 text-ink">
      <header className="border-b border-stone pb-6">
        <h1 className="font-display text-3xl mb-2 font-medium">Privacy Policy</h1>
        <p className="text-xs text-stone-dark font-mono">Last updated: September 15, 2026</p>
      </header>

      <section className="space-y-4 text-xs leading-relaxed">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-ink">1. Information We Collect</h2>
        <p>
          We collect information you provide directly to us when placing an order, creating an account, or subscribing to our newsletter. This includes your name, email address, mobile number, delivery address, and date of birth (if provided).
        </p>

        <h2 className="text-sm font-semibold uppercase tracking-wider text-ink pt-4">2. How We Use Your Information</h2>
        <p>
          We use your personal information to process orders, handle shipping and delivery, issue store credit vouchers, send birthday discount notifications, and improve customer experience.
        </p>

        <h2 className="text-sm font-semibold uppercase tracking-wider text-ink pt-4">3. Meta Pixel & Analytics</h2>
        <p>
          We use standard analytics tools including Meta Pixel to measure site traffic and ad performance. This collects anonymous interaction data such as product views, checkout initiation, and completed purchases.
        </p>

        <h2 className="text-sm font-semibold uppercase tracking-wider text-ink pt-4">4. Data Protection & Sharing</h2>
        <p>
          We do not sell or rent your personal data to third parties. We share necessary shipping data with courier partners strictly for physical package delivery.
        </p>

        <h2 className="text-sm font-semibold uppercase tracking-wider text-ink pt-4">5. Contact Us</h2>
        <p>
          For questions regarding your personal data or privacy rights, please email support@habitt.in.
        </p>
      </section>
    </main>
  );
}
