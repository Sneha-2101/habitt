import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
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

const fraunces = localFont({
  src: [
    { path: "./fonts/fraunces-normal-500.woff2", weight: "500", style: "normal" },
    { path: "./fonts/fraunces-normal-600.woff2", weight: "600", style: "normal" },
    { path: "./fonts/fraunces-italic-500.woff2", weight: "500", style: "italic" },
    { path: "./fonts/fraunces-italic-600.woff2", weight: "600", style: "italic" },
  ],
  variable: "--font-fraunces",
  display: "swap",
  fallback: ["serif"],
});
const inter = localFont({
  src: [
    { path: "./fonts/inter-normal-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/inter-normal-500.woff2", weight: "500", style: "normal" },
    { path: "./fonts/inter-normal-600.woff2", weight: "600", style: "normal" },
  ],
  variable: "--font-inter",
  display: "swap",
  fallback: ["sans-serif"],
});
const jbMono = localFont({
  src: [
    { path: "./fonts/jetbrains-mono-normal-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/jetbrains-mono-normal-500.woff2", weight: "500", style: "normal" },
  ],
  variable: "--font-jbmono",
  display: "swap",
  fallback: ["monospace"],
});

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

export const revalidate = 60;

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
