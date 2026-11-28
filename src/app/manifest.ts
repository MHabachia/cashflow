import type { MetadataRoute } from "next";
import { getGlobalAppSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

export default function manifest(): MetadataRoute.Manifest {
  const settings = getGlobalAppSettings();

  return {
    id: "/",
    name: `${settings.appName} – ${settings.appSubtitle}`,
    short_name: settings.appName.slice(0, 12),
    description: settings.appSubtitle,
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#030712",
    theme_color: settings.primaryColor || "#2563eb",
    lang: "de-DE",
    categories: ["finance", "productivity"],
    icons: [
      {
        src: "/api/branding/icon?size=192",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/api/branding/icon?size=512",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/api/branding/icon?size=512&maskable=1",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      {
        name: "Neue Ausgabe erfassen",
        short_name: "Ausgabe +",
        description: "Schnellerfassung öffnen",
        url: "/transactions?quickAdd=1",
        icons: [{ src: "/icon-192.png", sizes: "192x192" }],
      },
      {
        name: "Monatliche Fixkosten",
        short_name: "Fixkosten",
        description: "Fixkosten & Abos verwalten",
        url: "/recurring",
        icons: [{ src: "/icon-192.png", sizes: "192x192" }],
      },
    ],
  };
}
