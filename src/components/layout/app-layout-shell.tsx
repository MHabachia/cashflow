import React from "react";

/**
 * Seitengerüst. Die Breite passt sich per CSS an die Bildschirmgröße an
 * (früher per manuellem Mobil/Desktop-Umschalter).
 */
export function AppLayoutShell({
  header,
  commandBar,
  bottomNav,
  announcement,
  pwaStatusBar,
  children,
}: {
  header: React.ReactNode;
  commandBar: React.ReactNode;
  bottomNav: React.ReactNode;
  announcement?: React.ReactNode;
  pwaStatusBar: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-dvh flex flex-col bg-zinc-50 dark:bg-zinc-950 pb-32 lg:pb-10 transition-colors">
      {header}
      {commandBar}
      <main className="flex-1 w-full mx-auto px-4 py-4 space-y-4 max-w-2xl lg:max-w-7xl">
        {announcement}
        {pwaStatusBar}
        {children}
      </main>
      {bottomNav}
    </div>
  );
}
