import { get, set, del } from "idb-keyval";
import type { TransactionInput } from "@/actions/transaction-actions";
import {
  createClientTempId,
  withRejection,
  withRetry,
  without,
  type QueuedOfflineTransaction,
} from "@/lib/offline-queue-state";

export { createClientTempId, type QueuedOfflineTransaction };

const OFFLINE_QUEUE_KEY = "kosten_offline_tx_queue_v1";

export async function getOfflineQueue(): Promise<QueuedOfflineTransaction[]> {
  if (typeof window === "undefined") return [];
  try {
    const items = await get<QueuedOfflineTransaction[]>(OFFLINE_QUEUE_KEY);
    return items || [];
  } catch {
    return [];
  }
}

export async function enqueueOfflineTransaction(
  tx: TransactionInput
): Promise<QueuedOfflineTransaction> {
  const queue = await getOfflineQueue();
  const item: QueuedOfflineTransaction = {
    ...tx,
    clientTempId: tx.clientTempId || createClientTempId(),
    queuedAt: new Date().toISOString(),
  };
  queue.push(item);
  await set(OFFLINE_QUEUE_KEY, queue);
  window.dispatchEvent(new CustomEvent("offline-queue-updated"));
  return item;
}

async function updateQueue(
  change: (queue: QueuedOfflineTransaction[]) => QueuedOfflineTransaction[]
): Promise<void> {
  const queue = await getOfflineQueue();
  await set(OFFLINE_QUEUE_KEY, change(queue));
  window.dispatchEvent(new CustomEvent("offline-queue-updated"));
}

/** Entfernt einen übertragenen oder vom Nutzer verworfenen Eintrag. */
export async function removeOfflineTransactionFromQueue(clientTempId: string): Promise<void> {
  await updateQueue((queue) => without(queue, clientTempId));
}

/** Vom Server abgelehnt: Eintrag behalten, aber nicht automatisch erneut senden. */
export async function markOfflineTransactionRejected(clientTempId: string, reason: string): Promise<void> {
  await updateQueue((queue) => withRejection(queue, clientTempId, reason));
}

/** Gibt einen abgelehnten Eintrag zum erneuten Senden frei. */
export async function retryOfflineTransaction(clientTempId: string): Promise<void> {
  await updateQueue((queue) => withRetry(queue, clientTempId));
}

const OFFLINE_RECENT_TX_KEY = "kosten_recent_tx_snapshot_v1";

export interface CachedTransactionSnapshot {
  id: string;
  description: string;
  amountCents: number;
  date: string;
  type: "expense" | "income";
  costType: "variable" | "fixed" | "transfer";
}

export async function saveRecentTransactionsSnapshot(
  items: CachedTransactionSnapshot[]
): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    await set(OFFLINE_RECENT_TX_KEY, items.slice(0, 15));
  } catch {
    // Ignorieren
  }
}

export async function getRecentTransactionsSnapshot(): Promise<
  CachedTransactionSnapshot[]
> {
  if (typeof window === "undefined") return [];
  try {
    const items = await get<CachedTransactionSnapshot[]>(OFFLINE_RECENT_TX_KEY);
    return items || [];
  } catch {
    return [];
  }
}


const LOCAL_DATA_OWNER_KEY = "kosten_local_data_owner_v1";

/**
 * Entfernt angezeigte Finanzdaten aus dem Browser: Umsatz-Snapshot (IndexedDB)
 * und die Laufzeit-Caches des Service Workers (Seiten, RSC-Payloads).
 * Die Offline-Queue bleibt erhalten: Läuft nur die Sitzung ab, sollen noch
 * nicht übertragene Buchungen nach der erneuten Anmeldung nicht verloren gehen.
 * Wem sie gehören, klärt `claimLocalDataFor` nach der Anmeldung.
 */
export async function clearCachedFinancialData(): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    await del(OFFLINE_RECENT_TX_KEY);
  } catch {
    // IndexedDB nicht verfügbar
  }
  await clearRuntimeCaches();
}

/**
 * Bindet die lokalen Daten an den angemeldeten Benutzer. Gehören sie einem
 * anderen Benutzer (Nutzerwechsel am selben Gerät), werden sie vollständig
 * entfernt, bevor die Offline-Queue übertragen wird. So landen weder fremde
 * Offline-Buchungen im eigenen Konto noch fremde Seiten im Cache.
 * Ohne gespeicherten Besitzer (Daten aus älteren Versionen) übernimmt der
 * aktuelle Benutzer die Daten, damit keine Offline-Buchungen verloren gehen.
 */
export async function claimLocalDataFor(userId: string): Promise<void> {
  if (typeof window === "undefined" || !userId) return;
  try {
    const owner = await get<string>(LOCAL_DATA_OWNER_KEY);
    if (owner && owner !== userId) {
      await clearLocalUserData();
    }
    await set(LOCAL_DATA_OWNER_KEY, userId);
  } catch {
    // IndexedDB nicht verfügbar: dann gibt es auch keine lokalen Daten
  }
}

/**
 * Entfernt beim Abmelden alle lokal zwischengespeicherten Finanzdaten:
 * Offline-Queue, Umsatz-Snapshot (IndexedDB) und die Laufzeit-Caches des
 * Service Workers (Seiten, RSC-Payloads, API-Antworten). Der Precache mit der
 * App-Hülle bleibt erhalten, damit die Offline-Seite weiter funktioniert.
 */
export async function clearLocalUserData(): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    await Promise.all([
      del(OFFLINE_QUEUE_KEY),
      del(OFFLINE_RECENT_TX_KEY),
      del(LOCAL_DATA_OWNER_KEY),
    ]);
  } catch {
    // IndexedDB nicht verfügbar
  }
  await clearRuntimeCaches();
  window.dispatchEvent(new CustomEvent("offline-queue-updated"));
}

async function clearRuntimeCaches(): Promise<void> {
  try {
    if ("caches" in window) {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => !name.includes("precache"))
          .map((name) => caches.delete(name))
      );
    }
  } catch {
    // Cache Storage nicht verfügbar
  }
}
