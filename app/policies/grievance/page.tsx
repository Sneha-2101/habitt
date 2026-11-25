import Link from "next/link";
import { getBusinessProfile } from "@/lib/site/business";
import { getSessionUser } from "@/lib/sessions";
import { getContent } from "@/lib/content/content";
import { ContentBlocks } from "@/components/ContentBlocks";

export const dynamic = "force-dynamic";

export default async function GrievanceOfficerPage() {
  const [profile, sessionUser, extraContent] = await Promise.all([
    getBusinessProfile(),
    getSessionUser().catch(() => null),
    getContent("policy.grievance").catch(() => null),
  ]);
  const isStaff = sessionUser?.role === "STAFF" || sessionUser?.role === "OWNER";

  const officerName = profile.grievanceOfficer.name;
  const officerEmail = profile.grievanceOfficer.email || profile.supportEmail;
  const officerPhone = profile.grievanceOfficer.phone || profile.phone;
  const officerAddress =
    profile.grievanceOfficer.address || profile.formattedAddress;
  const missingOfficerDetails = !officerName || !officerEmail;

  return (
    <main className="max-w-3xl mx-auto px-4 sm:px-7 py-12 space-y-6">
      <div>
        <h1 className="font-display text-3xl text-ink font-medium mb-2">Grievance Redressal Mechanism</h1>
        <p className="text-xs text-stone-dark font-mono uppercase tracking-wider">
          Compliance with Information Technology Act & Consumer Protection (E-Commerce) Rules
        </p>
      </div>

      <div className="prose text-xs text-[#4B473F] leading-relaxed space-y-5 pt-4 border-t border-stone/50">
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-ink">1. Grievance Officer Details</h2>
          <p>
            In accordance with the Information Technology Act, 2000 and the Consumer Protection (E-Commerce) Rules, 2020, the details of the designated Grievance Officer{profile.displayName ? ` for ${profile.displayName}` : ""} are published below:
          </p>
          <div className="bg-paper p-4 border border-stone space-y-1.5 text-xs text-ink font-sans">
            {officerName && <div><strong>Name:</strong> {officerName}</div>}
            <div><strong>Designation:</strong> Grievance Redressal Officer</div>
            {officerEmail && <div><strong>Email:</strong> <a href={`mailto:${officerEmail}`} className="underline">{officerEmail}</a></div>}
            {officerPhone && <div><strong>Contact Line:</strong> {officerPhone}</div>}
            {officerAddress && <div><strong>Official Address:</strong> {officerAddress}</div>}
          </div>
          {missingOfficerDetails && isStaff && (
            <div className="p-2.5 bg-amber-50 border border-amber-200 text-amber-900 text-[11.5px] rounded-xs">
              Set grievance officer name and email in <Link href="/admin/settings" className="underline font-medium">/admin/settings</Link>
            </div>
          )}
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-ink">2. Statutory Timelines</h2>
          <p>
            Our Grievance Redressal mechanism adheres strictly to legal mandates under the Consumer Protection (E-Commerce) Rules, 2020:
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li>
              <strong>48-Hour Acknowledgment:</strong> Every consumer grievance received will be acknowledged within 48 hours with a unique ticket tracking number.
            </li>
            <li>
              <strong>1-Month Resolution:</strong> All complaints and grievances will be investigated and redressed within 1 month (30 calendar days) from the date of receipt.
            </li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-ink">3. How to Lodge a Grievance</h2>
          <p>
            You may lodge a formal grievance through any of the following channels:
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li>
              Via our <Link href="/contact" className="underline text-ink font-medium">Online Contact & Support Form</Link> by selecting category <strong>Grievance</strong>.
            </li>
            <li>
              If you have an existing user account, log in to your <Link href="/account" className="underline text-ink font-medium">Account Portal</Link> and submit a ticket.
            </li>
            <li>
              By writing directly to the Grievance Officer at the email address provided above, specifying your order number, contact details, and the nature of your complaint.
            </li>
          </ul>
        </section>

        {extraContent?.isPublished && extraContent.body.trim().length > 0 && (
          <section className="space-y-2 pt-4 border-t border-stone/40">
            <ContentBlocks body={extraContent.body} />
          </section>
        )}
      </div>
    </main>
  );
}
