"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RotateCcw } from "lucide-react";

/**
 * Fehlerseite für den angemeldeten Bereich. Zeigt bewusst keine
 * Fehlermeldung (sie kann interne Details enthalten), nur die Kennung, unter
 * der der Fehler im Server-Log steht.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[AppError]", error.digest ?? error);
  }, [error]);

  return (
    <div
      role="alert"
      className="mx-auto flex min-h-[40vh] max-w-md flex-col items-center justify-center gap-4 px-4 text-center"
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-red-500/10 text-red-600 dark:text-red-400">
        <AlertTriangle className="h-6 w-6" aria-hidden="true" />
      </div>
      <div className="space-y-1">
        <h1 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">Etwas ist schiefgelaufen</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Die Seite konnte nicht geladen werden. Versuche es erneut oder kehre zur Übersicht zurück.
        </p>
        {error.digest && (
          <p className="text-xs text-zinc-400 dark:text-zinc-500">Fehlerkennung: {error.digest}</p>
        )}
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <button
          type="button"
          onClick={reset}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-brand px-4 text-sm font-semibold text-white hover:opacity-90"
        >
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          Erneut versuchen
        </button>
        <Link
          href="/"
          className="inline-flex min-h-11 items-center rounded-xl border border-zinc-200 px-4 text-sm font-semibold text-zinc-700 hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          Zur Übersicht
        </Link>
      </div>
    </div>
  );
}
