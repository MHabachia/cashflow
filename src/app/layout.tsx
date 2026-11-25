import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Toaster } from "sonner";
import { getGlobalAppSettings } from "@/lib/settings";
import { headers } from "next/headers";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const settings = getGlobalAppSettings();
  const cacheBust = encodeURIComponent(
    `${settings.primaryColor}_${settings.customLogoPath || "default"}`
  );

  return {
    title: `${settings.appName} – ${settings.appSubtitle}`,
    description: settings.appSubtitle,
    manifest: "/manifest.webmanifest",
    icons: {
      icon: `/api/branding/icon?size=64&v=${cacheBust}`,
      shortcut: `/api/branding/icon?size=64&v=${cacheBust}`,
      apple: [
        {
          url: `/api/branding/icon?size=180&v=${cacheBust}`,
          sizes: "180x180",
          type: "image/png",
        },
      ],
    },
    appleWebApp: {
      capable: true,
      statusBarStyle: "black-translucent",
      title: settings.appName,
    },
    formatDetection: {
      telephone: false,
    },
  };
}

export async function generateViewport(): Promise<Viewport> {
  const settings = getGlobalAppSettings();
  return {
    width: "device-width",
    initialScale: 1,
    // Zoomen bleibt erlaubt (WCAG 1.4.4). Das automatische iOS-Zoomen beim
    // Fokussieren von Feldern verhindert globals.css über 16px Schriftgröße.
    viewportFit: "cover",
    themeColor: [
      {
        media: "(prefers-color-scheme: light)",
        color: settings.primaryColor || "#2563eb",
      },
      { media: "(prefers-color-scheme: dark)", color: "#030712" },
    ],
  };
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const settings = getGlobalAppSettings();
  const brandColor = settings.primaryColor || "#2563eb";
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html
      lang="de"
      className="h-full antialiased"
      suppressHydrationWarning
      style={{ ["--brand-primary" as string]: brandColor }}
    >
      <head>
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var mode = localStorage.getItem('cashflow_theme');
                  var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
                  var isDark = mode === 'dark' || (!mode && prefersDark);
                  if (isDark) {
                    document.documentElement.classList.add('dark');
                  } else {
                    document.documentElement.classList.remove('dark');
                  }
                } catch (e) {}
              })();
            `,
          }}
        />
      </head>
      <body className="min-h-full bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100 selection:bg-blue-600 selection:text-white">
        {children}
        <Toaster
          position="bottom-center"
          richColors
          closeButton
          offset={{ bottom: "24px" }}
          mobileOffset={{ bottom: "80px" }}
        />
      </body>
    </html>
  );
}
