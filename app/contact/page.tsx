import Script from "next/script";
import Link from "next/link";
import { getSettings } from "@/lib/settings";
import ContactClient from "./ContactClient";

export const dynamic = "force-dynamic";

export default async function ContactPage() {
  const settings = await getSettings();

  return (
    <main className="max-w-4xl mx-auto px-4 sm:px-7 py-12 space-y-10">
      <div>
        <h1 className="font-display text-3xl text-ink font-medium mb-2">Contact & Support</h1>
        <p className="text-xs text-stone-dark">
          We are here to assist with orders, deliveries, returns, exchanges, or statutory grievances.
        </p>
      </div>

      {/* Official Communication Channels */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-xs">
        <div className="bg-white border border-stone p-5 space-y-2">
          <h3 className="font-semibold text-ink uppercase tracking-wider text-[11px]">
            Customer Support
          </h3>
          <p className="text-stone-dark">
            Direct email assistance for orders and sizing inquiries:
          </p>
          <p className="text-ink font-medium">
            <a href={`mailto:${settings.supportEmail}`} className="underline">
              {settings.supportEmail}
            </a>
          </p>
        </div>

        <div className="bg-white border border-stone p-5 space-y-2">
          <h3 className="font-semibold text-ink uppercase tracking-wider text-[11px]">
            Direct Lines
          </h3>
          <p className="text-stone-dark">Phone and messaging support during operating hours:</p>
          {settings.businessPhone && (
            <p className="text-ink font-medium">Phone: {settings.businessPhone}</p>
          )}
          {settings.whatsappSupportNumber && (
            <p className="text-ink font-medium">WhatsApp: {settings.whatsappSupportNumber}</p>
          )}
          {!settings.businessPhone && !settings.whatsappSupportNumber && (
            <p className="text-stone-dark italic">Phone support available via online ticketing.</p>
          )}
        </div>

        <div className="bg-white border border-stone p-5 space-y-2">
          <h3 className="font-semibold text-ink uppercase tracking-wider text-[11px]">
            Statutory Redressal
          </h3>
          <p className="text-stone-dark">
            Designated Grievance Officer for consumer protection complaints:
          </p>
          <p className="text-ink font-medium">
            <Link href="/policies/grievance" className="underline hover:opacity-80">
              Grievance Redressal Policy &rarr;
            </Link>
          </p>
        </div>
      </div>

      {/* Interactive Guest Ticket Form */}
      <ContactClient />

      {process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY && (
        <Script
          src="https://challenges.cloudflare.com/turnstile/v0/api.js"
          strategy="afterInteractive"
        />
      )}
    </main>
  );
}
