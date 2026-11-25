import type { Metadata, Viewport } from "next";
import { Fraunces, Inter, JetBrains_Mono } from "next/font/google";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import WhatsAppWidget from "@/components/WhatsAppWidget";
import Providers from "@/components/Providers";
import MetaPixel from "@/components/MetaPixel";
import RegisterSW from "@/components/pwa/RegisterSW";
import { getSettings } from "@/lib/settings";
import { buildBusinessProfile } from "@/lib/site/business";
import "./globals.css";

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  style: ["normal", "italic"],
  weight: ["500", "600"],
});
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", weight: ["400", "500", "600"] });
const jbMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jbmono", weight: ["400", "500"] });

// temporary until the header stops reading the session on the server
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Habitt — considered basics",
  description: "Heavier fabrics, honest fits. Habitt makes clothes with a quiet weight to them.",
};

export const viewport: Viewport = {
  themeColor: "#111111",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const settings = await getSettings();
  const profile = buildBusinessProfile(settings);

  return (
    <html lang="en" className={`${fraunces.variable} ${inter.variable} ${jbMono.variable}`}>
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
        </Providers>
      </body>
    </html>
  );
}
