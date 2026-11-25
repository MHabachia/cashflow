"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  getOfflineQueue,
  getRecentTransactionsSnapshot,
  type QueuedOfflineTransaction,
  type CachedTransactionSnapshot,
} from "@/lib/offline-queue";
import { formatCents, formatDateDE } from "@/lib/format";
import { WifiOff, RefreshCw, Home, CloudUpload } from "lucide-react";

export default function OfflineFallbackPage() {
  const [queued, setQueued] = useState<QueuedOfflineTransaction[]>([]);
  const [recentSnapshot, setRecentSnapshot] = useState<
    CachedTransactionSnapshot[]
  >([]);

  useEffect(() => {
    getOfflineQueue().then(setQueued);
    getRecentTransactionsSnapshot().then(setRecentSnapshot);
  }, []);

  return (
    <div className="min-h-dvh flex flex-col items-center justify-center px-5 py-10 bg-zinc-50 dark:bg-zinc-950 max-w-lg mx-auto">
      <div className="w-16 h-16 rounded-2xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center mb-4">
        <WifiOff className="w-8 h-8" />
      </div>
      <h1 className="text-xl font-bold text-center">Offline-Modus aktiv</h1>
      <p className="text-sm text-zinc-500 dark:text-zinc-400 text-center mt-1.5">
        Du hast aktuell keine Verbindung zum Server. Deine lokal gespeicherten
        Buchungen aus IndexedDB siehst du hier:
      </p>

      {queued.length > 0 && (
        <div className="w-full mt-5 bg-white dark:bg-zinc-900 border border-amber-500/30 rounded-2xl p-4 shadow-sm">
          <h2 className="text-xs font-bold text-amber-600 dark:text-amber-400 flex items-center gap-1.5 mb-2">
            <CloudUpload className="w-4 h-4" />
            <span>Wartende Offline-Buchungen ({queued.length})</span>
          </h2>
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {queued.map((q) => (
              <div
                key={q.clientTempId}
                className="py-2 flex items-center justify-between text-xs"
              >
                <div>
                  <p className="font-semibold">{q.description}</p>
                  <p className="text-zinc-500">{formatDateDE(q.date)}</p>
                </div>
                <span className="font-bold">{formatCents(q.amountCents)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {recentSnapshot.length > 0 && (
        <div className="w-full mt-4 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-4 shadow-sm">
          <h2 className="text-xs font-bold text-zinc-500 mb-2">
            Letzte synchronisierte Buchungen (Offline-Snapshot)
          </h2>
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {recentSnapshot.slice(0, 6).map((tx) => (
              <div
                key={tx.id}
                className="py-2 flex items-center justify-between text-xs"
              >
                <div>
                  <p className="font-medium">{tx.description}</p>
                  <p className="text-zinc-500">{formatDateDE(tx.date)}</p>
                </div>
                <span className="font-semibold">
                  {tx.type === "income" ? "+" : "-"}
                  {formatCents(tx.amountCents)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-3 mt-6">
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="px-4 py-2.5 rounded-xl bg-blue-600 text-white text-xs font-semibold flex items-center gap-1.5"
        >
          <RefreshCw className="w-4 h-4" />
          <span>Erneut versuchen</span>
        </button>
        <Link
          href="/"
          className="px-4 py-2.5 rounded-xl bg-zinc-200 dark:bg-zinc-800 text-xs font-semibold flex items-center gap-1.5"
        >
          <Home className="w-4 h-4" />
          <span>Zur Übersicht</span>
        </Link>
      </div>
    </div>
  );
}
