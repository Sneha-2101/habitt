import type { Metadata, Viewport } from "next";
import { Fraunces, Inter, JetBrains_Mono } from "next/font/google";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import WhatsAppWidget from "@/components/WhatsAppWidget";
import Providers from "@/components/Providers";
import MetaPixel from "@/components/MetaPixel";
import ConsentNotice from "@/components/ConsentNotice";
import RegisterSW from "@/components/pwa/RegisterSW";
import { getSettings } from "@/lib/settings";
import { buildBusinessProfile } from "@/lib/site/business";
import { getSiteUrl } from "@/lib/seo/site-url";
import { isIndexingAllowed } from "@/lib/seo/indexing";
import { truncateSeoDescription } from "@/lib/seo/metadata";
import "./globals.css";

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  style: ["normal", "italic"],
  weight: ["500", "600"],
});
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", weight: ["400", "500", "600"] });
const jbMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jbmono", weight: ["400", "500"] });

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSettings();
  const profile = buildBusinessProfile(settings);
  const siteUrl = getSiteUrl();
  const allowed = isIndexingAllowed({
    seoIndexingEnabled: settings.seoIndexingEnabled ?? false,
    nodeEnv: process.env.NODE_ENV,
    vercelEnv: process.env.VERCEL_ENV,
    siteUrl,
  });

  const brandName = profile.displayName || profile.legalName || settings.businessName;

  return {
    ...(siteUrl ? { metadataBase: new URL(siteUrl) } : {}),
    title: {
      default: brandName,
      template: `%s | ${brandName}`,
    },
    description: truncateSeoDescription(profile.tagline || brandName, 155),
    robots: allowed ? { index: true, follow: true } : { index: false, follow: false },
    ...(settings.googleSiteVerification
      ? { verification: { google: settings.googleSiteVerification } }
      : {}),
  };
}

export const viewport: Viewport = {
  themeColor: "#111111",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const settings = await getSettings();
  const profile = buildBusinessProfile(settings);

  return (
    <html lang="en-IN" className={`${fraunces.variable} ${inter.variable} ${jbMono.variable}`}>
      <body suppressHydrationWarning className="flex flex-col min-h-screen">
        <Providers>
          <RegisterSW />
          <MetaPixel />
          <Header />
          <div className="flex-1">{children}</div>
          <Footer
            businessName={profile.displayName}
            businessTagline={profile.tagline}
            legalName={profile.legalName}
            businessAddress={profile.formattedAddress}
            supportEmail={profile.supportEmail}
            instagramUrl={profile.social.instagramUrl}
            facebookUrl={profile.social.facebookUrl}
          />
          <WhatsAppWidget phoneNumber={settings.whatsappSupportNumber} />
          <ConsentNotice />
        </Providers>
      </body>
    </html>
  );
}
