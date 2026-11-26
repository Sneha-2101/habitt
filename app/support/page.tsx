import Link from "next/link";
import { getSettings } from "@/lib/settings";
import { buildPageMetadata } from "@/lib/seo/metadata";
import { getSiteUrl } from "@/lib/seo/site-url";

export const revalidate = 3600;

export async function generateMetadata() {
  const settings = await getSettings();
  return buildPageMetadata({
    title: "Customer Support & FAQ",
    description: `Get help with sizing, order updates, shipping, and return requests at ${settings.businessName}.`,
    path: "/support",
    settings,
    siteUrl: getSiteUrl(),
  });
}

export default async function SupportPage() {
  const settings = await getSettings();

  const rawWa = settings.whatsappSupportNumber ? settings.whatsappSupportNumber.replace(/[^0-9]/g, "") : "";
  const waNumber = rawWa.length === 10 ? `91${rawWa}` : rawWa;

  return (
    <main className="max-w-3xl mx-auto px-4 sm:px-7 py-12 space-y-8">
      <div>
        <h1 className="font-display text-3xl text-ink font-medium mb-2">Customer Support & FAQ</h1>
        <p className="text-sm text-stone-dark">
          We&apos;re here to help with sizing, order updates, shipping, or return requests.
        </p>
      </div>

      {/* Contact Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {settings.supportEmail && (
          <div className="p-5 border border-stone bg-white rounded-sm space-y-1">
            <h3 className="text-xs font-semibold text-stone-dark uppercase tracking-wider">Email Support</h3>
            <p className="text-sm font-medium text-ink">
              <a href={`mailto:${settings.supportEmail}`} className="hover:underline">
                {settings.supportEmail}
              </a>
            </p>
          </div>
        )}

        {settings.whatsappSupportNumber && (
          <div className="p-5 border border-stone bg-white rounded-sm space-y-1">
            <h3 className="text-xs font-semibold text-stone-dark uppercase tracking-wider">WhatsApp Support</h3>
            <p className="text-sm font-medium text-ink">
              <a
                href={`https://wa.me/${waNumber}`}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:underline"
              >
                {settings.whatsappSupportNumber}
              </a>
            </p>
          </div>
        )}

        {settings.businessPhone && (
          <div className="p-5 border border-stone bg-white rounded-sm space-y-1">
            <h3 className="text-xs font-semibold text-stone-dark uppercase tracking-wider">Phone Support</h3>
            <p className="text-sm font-medium text-ink">
              <a href={`tel:${settings.businessPhone}`} className="hover:underline">
                {settings.businessPhone}
              </a>
            </p>
          </div>
        )}
      </div>

      {/* Frequently Asked Questions */}
      <section className="space-y-4 pt-4 border-t border-stone/50">
        <h2 className="font-display text-xl text-ink font-medium mb-4">Frequently Asked Questions</h2>

        <div className="space-y-3">
          <div className="p-4 border border-stone/60 bg-white rounded-sm space-y-1">
            <h4 className="text-sm font-semibold text-ink">How long does shipping take?</h4>
            <p className="text-xs text-stone-dark leading-relaxed">
              Delivery takes up to {settings.maxDeliveryDays} days of dispatch depending on your location.
              {settings.dispatchHandlingNote ? ` ${settings.dispatchHandlingNote}` : ""}
            </p>
          </div>

          <div className="p-4 border border-stone/60 bg-white rounded-sm space-y-1">
            <h4 className="text-sm font-semibold text-ink">What is your return & exchange policy?</h4>
            <p className="text-xs text-stone-dark leading-relaxed">
              We offer a {settings.returnWindowDays}-day hassle-free return window for all unworn garments with original tags attached. You can initiate a return directly from your <Link href="/account" className="underline text-ink">Account page</Link>.
            </p>
          </div>

          <div className="p-4 border border-stone/60 bg-white rounded-sm space-y-1">
            <h4 className="text-sm font-semibold text-ink">How do I choose the right size?</h4>
            <p className="text-xs text-stone-dark leading-relaxed">
              Every product detail page includes a dedicated &quot;Size guide&quot; next to the size selector with exact garment measurements in inches.
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
