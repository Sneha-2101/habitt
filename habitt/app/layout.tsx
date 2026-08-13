import type { Metadata } from "next";
import { Fraunces, Inter, JetBrains_Mono } from "next/font/google";
import Header from "@/components/Header";
import Providers from "@/components/Providers";
import "./globals.css";

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  style: ["normal", "italic"],
  weight: ["500", "600"],
});
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", weight: ["400", "500", "600"] });
const jbMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jbmono", weight: ["400", "500"] });

export const metadata: Metadata = {
  title: "Habitt — considered basics",
  description: "Heavier fabrics, honest fits. Habitt makes clothes with a quiet weight to them.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${fraunces.variable} ${inter.variable} ${jbMono.variable}`}>
      <body>
        <Providers>
          <Header />
          {children}
        </Providers>
      </body>
    </html>
  );
}
