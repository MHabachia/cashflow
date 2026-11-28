import { Loader2 } from "lucide-react";

/** Ladeanzeige, solange eine Seite im angemeldeten Bereich auf dem Server lädt. */
export default function AppLoading() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-zinc-500 dark:text-zinc-400"
    >
      <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
      <span className="text-sm">Wird geladen …</span>
    </div>
  );
}
