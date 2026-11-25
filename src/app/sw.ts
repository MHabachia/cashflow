import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { NetworkOnly, Serwist } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  // Neue Versionen warten, bis der Nutzer „Aktualisieren“ wählt (SwUpdateNotifier)
  skipWaiting: false,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    // Persönliche API-Daten (Belege, Profilbilder, Exporte, Backups, Bank-Sync)
    // niemals im Service-Worker-Cache ablegen. Ausnahme: öffentliche Branding-Icons.
    {
      matcher: ({ sameOrigin, url: { pathname } }) =>
        sameOrigin &&
        pathname.startsWith("/api/") &&
        !pathname.startsWith("/api/branding/"),
      handler: new NetworkOnly(),
    },
    ...defaultCache,
  ],
  fallbacks: {
    entries: [
      {
        url: "/~offline",
        matcher({ request }) {
          return request.destination === "document";
        },
      },
    ],
  },
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

// Push-Benachrichtigungen (Budgets, Bankzugriff, hohe Abbuchungen, Prüf-Inbox)
self.addEventListener("push", (event) => {
  let data: { title?: string; body?: string; url?: string; tag?: string } = {};
  try {
    data = event.data?.json() ?? {};
  } catch {
    data = { body: event.data?.text() };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "Cashflow", {
      body: data.body,
      tag: data.tag,
      icon: "/api/branding/icon?size=192",
      badge: "/api/branding/icon?size=64",
      data: { url: data.url || "/" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const raw = (event.notification.data as { url?: string } | undefined)?.url || "/";
  // Nur Pfade innerhalb der App öffnen
  const target = new URL(raw.startsWith("/") ? raw : "/", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        if ("focus" in client) {
          await (client as WindowClient).navigate(target).catch(() => undefined);
          return (client as WindowClient).focus();
        }
      }
      return self.clients.openWindow(target);
    })()
  );
});

serwist.addEventListeners();
