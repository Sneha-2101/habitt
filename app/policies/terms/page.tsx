import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

export default async function TermsOfServicePage() {
  const settings = await getSettings();
  const companyName = settings.legalName || settings.businessName;

  return (
    <main className="max-w-3xl mx-auto px-4 sm:px-7 py-12 space-y-8 text-ink">
      <header className="border-b border-stone pb-6">
        <h1 className="font-display text-3xl mb-2 font-medium">Terms of Service</h1>
        <p className="text-xs text-stone-dark font-mono">Last updated: September 15, 2026</p>
      </header>

      <section className="space-y-4 text-xs leading-relaxed">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-ink">1. Overview</h2>
        <p>
          Welcome to {settings.businessName} (&quot;we&quot;, &quot;us&quot;, &quot;our&quot;). By visiting our website and/or purchasing from us, you engage in our &quot;Service&quot; and agree to be bound by the following Terms of Service.
        </p>

        <h2 className="text-sm font-semibold uppercase tracking-wider text-ink pt-4">2. Orders & Pricing</h2>
        <p>
          All prices are listed in Indian Rupees (INR) inclusive of applicable taxes. We reserve the right to accept or cancel any order for reason of stock unavailability, pricing errors, or suspicion of fraudulent activity.
        </p>

        <h2 className="text-sm font-semibold uppercase tracking-wider text-ink pt-4">3. Cash on Delivery & Store Credit</h2>
        <p>
          Cash on Delivery (COD) is available subject to eligibility checks based on order subtotal and customer delivery history. For COD returns, refunds are issued strictly as Store Credit vouchers linked to your account ledger. Store Credit has no expiration date and can be applied to any future order.
        </p>

        <h2 className="text-sm font-semibold uppercase tracking-wider text-ink pt-4">4. Intellectual Property</h2>
        <p>
          All content included on this site, such as text, graphics, logos, images, and software, is the property of {companyName} and protected by copyright and intellectual property laws.
        </p>

        {settings.supportEmail && (
          <>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-ink pt-4">5. Contact Information</h2>
            <p>
              Questions about the Terms of Service should be sent to us at {settings.supportEmail}.
            </p>
          </>
        )}
      </section>
    </main>
  );
}
