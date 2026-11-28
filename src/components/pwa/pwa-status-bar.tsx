"use client";

import { useEffect, useState, useCallback } from "react";
import {
  claimLocalDataFor,
  getOfflineQueue,
  markOfflineTransactionRejected,
  removeOfflineTransactionFromQueue,
  retryOfflineTransaction,
  type QueuedOfflineTransaction,
} from "@/lib/offline-queue";
import { pendingItems, rejectedItems, toTransactionInput } from "@/lib/offline-queue-state";
import { createTransactionAction } from "@/actions/transaction-actions";
import { formatCents } from "@/lib/format";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { WifiOff, CloudUpload, Share, PlusSquare, X, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { SwUpdateNotifier } from "./sw-update-notifier";

export function PwaStatusBar({ userId }: { userId: string }) {
  const router = useRouter();
  const [isOnline, setIsOnline] = useState(true);
  const [queue, setQueue] = useState<QueuedOfflineTransaction[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [showIosInstallHint, setShowIosInstallHint] = useState(false);
  const [discardCandidate, setDiscardCandidate] = useState<QueuedOfflineTransaction | null>(null);

  const queueCount = pendingItems(queue).length;
  const rejected = rejectedItems(queue);

  const refreshQueueCount = useCallback(async () => {
    const q = await getOfflineQueue();
    setQueue(q);
    return pendingItems(q);
  }, []);

  const syncOfflineQueue = useCallback(async () => {
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    const pending = pendingItems(await getOfflineQueue());
    if (pending.length === 0) return;

    setSyncing(true);
    let syncedCount = 0;

    for (const item of pending) {
      try {
        const res = await createTransactionAction(toTransactionInput(item));
        if (res.success) {
          await removeOfflineTransactionFromQueue(item.clientTempId);
          syncedCount++;
        } else {
          // Vom Server abgelehnt (z. B. Kategorie inzwischen gelöscht): nicht
          // endlos erneut senden, aber behalten, bis der Nutzer entscheidet
          await markOfflineTransactionRejected(
            item.clientTempId,
            res.error || "unbekannter Fehler"
          );
          toast.error(
            `Offline-Buchung „${item.description}“ konnte nicht übernommen werden: ${
              res.error || "unbekannter Fehler"
            }. Sie bleibt gespeichert, bis du sie erneut sendest oder verwirfst.`,
            { duration: 15000 }
          );
        }
      } catch {
        // Noch keine stabile Verbindung -> beim nächsten Mal fortsetzen
        break;
      }
    }

    setSyncing(false);
    await refreshQueueCount();

    if (syncedCount > 0) {
      toast.success(
        `${syncedCount} Offline-Buchung${syncedCount > 1 ? "en" : ""} automatisch synchronisiert!`
      );
      router.refresh();
    }
  }, [refreshQueueCount, router]);

  const retryRejected = useCallback(
    async (clientTempId: string) => {
      await retryOfflineTransaction(clientTempId);
      await refreshQueueCount();
      await syncOfflineQueue();
    },
    [refreshQueueCount, syncOfflineQueue]
  );

  const confirmDiscard = useCallback(async () => {
    if (!discardCandidate) return;
    await removeOfflineTransactionFromQueue(discardCandidate.clientTempId);
    setDiscardCandidate(null);
    await refreshQueueCount();
  }, [discardCandidate, refreshQueueCount]);

  useEffect(() => {
    setIsOnline(navigator.onLine);
    // Erst klären, wem die lokalen Daten gehören, dann die Queue übertragen
    claimLocalDataFor(userId)
      .then(() => refreshQueueCount())
      .then((q) => {
        if (navigator.onLine && q.length > 0) {
          syncOfflineQueue();
        }
      });

    const handleOnline = () => {
      setIsOnline(true);
      syncOfflineQueue();
    };
    const handleOffline = () => {
      setIsOnline(false);
    };
    const handleQueueUpdate = () => {
      refreshQueueCount();
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    window.addEventListener("offline-queue-updated", handleQueueUpdate);

    // iOS Safari Erkennung: Hinweis "Zum Home-Bildschirm" zeigen, falls nicht bereits als Standalone-PWA geöffnet
    const ua = window.navigator.userAgent;
    const isIos = /iPad|iPhone|iPod/.test(ua);
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone ===
        true;
    const dismissed = localStorage.getItem("kosten_ios_install_dismissed");

    if (isIos && !isStandalone && !dismissed) {
      setShowIosInstallHint(true);
    }

    // App-Shell Routen im Hintergrund für den Offline-Modus vorwärmen (Pre-Warming)
    if (navigator.onLine) {
      const coreRoutes = [
        "/",
        "/transactions",
        "/recurring",
        "/categories",
        "/settings",
      ];
      setTimeout(() => {
        for (const r of coreRoutes) {
          router.prefetch(r);
        }
      }, 1500);
    }

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("offline-queue-updated", handleQueueUpdate);
    };
  }, [refreshQueueCount, syncOfflineQueue, userId]);

  return (
    <div className="space-y-2">
      <SwUpdateNotifier />
      {!isOnline && (
        <div className="bg-amber-500/15 border border-amber-500/30 text-amber-800 dark:text-amber-300 px-4 py-2.5 rounded-2xl text-xs font-medium flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <WifiOff className="w-4 h-4 shrink-0" />
            <span>
              Offline-Modus aktiv: Neue Einträge werden lokal gespeichert und
              automatisch synchronisiert ({queueCount} wartend).
            </span>
          </div>
        </div>
      )}

      {isOnline && queueCount > 0 && (
        <div className="bg-blue-500/15 border border-blue-500/30 text-blue-800 dark:text-blue-300 px-4 py-2.5 rounded-2xl text-xs font-medium flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CloudUpload className="w-4 h-4 shrink-0 animate-bounce" />
            <span>
              {syncing
                ? `Synchronisiere ${queueCount} Offline-Einträge...`
                : `${queueCount} Offline-Einträge bereit zur Synchronisation`}
            </span>
          </div>
          {!syncing && (
            <button
              type="button"
              onClick={syncOfflineQueue}
              className="px-2.5 py-1 rounded-lg bg-blue-600 text-white font-semibold"
            >
              Jetzt synchronisieren
            </button>
          )}
        </div>
      )}

      {rejected.length > 0 && (
        <div
          role="alert"
          className="bg-red-500/10 border border-red-500/30 text-red-800 dark:text-red-300 px-4 py-2.5 rounded-2xl text-xs font-medium space-y-2"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>
              {rejected.length === 1
                ? "1 Offline-Buchung wurde abgelehnt"
                : `${rejected.length} Offline-Buchungen wurden abgelehnt`}
            </span>
          </div>
          <ul className="divide-y divide-red-500/20">
            {rejected.map((item) => (
              <li
                key={item.clientTempId}
                className="py-2 flex flex-wrap items-center justify-between gap-2"
              >
                <div className="min-w-0">
                  <p className="font-semibold truncate">
                    {item.description} · {formatCents(item.amountCents)}
                  </p>
                  <p className="opacity-80">{item.rejectionReason}</p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => retryRejected(item.clientTempId)}
                    disabled={syncing || !isOnline}
                    aria-label={`Offline-Buchung „${item.description}“ erneut senden`}
                    className="min-h-11 px-3 rounded-lg bg-red-600 text-white font-semibold disabled:opacity-50"
                  >
                    Erneut senden
                  </button>
                  <button
                    type="button"
                    onClick={() => setDiscardCandidate(item)}
                    aria-label={`Offline-Buchung „${item.description}“ verwerfen`}
                    className="min-h-11 px-3 rounded-lg border border-red-500/40 font-semibold"
                  >
                    Verwerfen
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <ConfirmModal
        open={discardCandidate !== null}
        title="Offline-Buchung verwerfen?"
        message={
          discardCandidate
            ? `„${discardCandidate.description}“ (${formatCents(discardCandidate.amountCents)}) wird endgültig von diesem Gerät entfernt und nicht gebucht.`
            : ""
        }
        confirmText="Verwerfen"
        onConfirm={confirmDiscard}
        onCancel={() => setDiscardCandidate(null)}
      />

      {showIosInstallHint && (
        <div className="bg-white dark:bg-zinc-900 border border-blue-500/30 rounded-2xl p-3.5 shadow-sm flex items-start justify-between gap-3">
          <div className="text-xs space-y-1">
            <p className="font-bold text-zinc-900 dark:text-white">
              Als iPhone-App installieren
            </p>
            <p className="text-zinc-500 dark:text-zinc-400 flex flex-wrap items-center gap-1">
              Tippe unten in Safari auf{" "}
              <span className="inline-flex items-center gap-0.5 font-semibold text-blue-600 dark:text-blue-400">
                <Share className="w-3.5 h-3.5" /> Teilen
              </span>{" "}
              und wähle{" "}
              <span className="inline-flex items-center gap-0.5 font-semibold text-zinc-800 dark:text-zinc-200">
                <PlusSquare className="w-3.5 h-3.5" /> Zum Home-Bildschirm
              </span>
              .
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              localStorage.setItem("kosten_ios_install_dismissed", "1");
              setShowIosInstallHint(false);
            }}
            className="p-1 text-zinc-400 hover:text-zinc-700"
            aria-label="Schließen"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}
