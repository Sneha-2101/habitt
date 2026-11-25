import type { MetadataRoute } from "next";
import { getBusinessProfile } from "@/lib/site/business";

export const dynamic = "force-dynamic";

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const profile = await getBusinessProfile().catch(() => null);
  const name = profile?.displayName || "Habitt";
  const description =
    profile?.tagline ||
    "Heavier fabrics, honest fits. Habitt makes clothes with a quiet weight to them.";

  return {
    name,
    short_name: name,
    description,
    start_url: "/",
    display: "standalone",
    background_color: "#F6F4F1",
    theme_color: "#111111",
    icons: [
      {
        src: "/logo.png",
        sizes: "192x192",
        type: "image/png",
      },
    ],
  };
}
