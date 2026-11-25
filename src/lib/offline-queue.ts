import { get, set, del } from "idb-keyval";
import type { TransactionInput } from "@/actions/transaction-actions";

const OFFLINE_QUEUE_KEY = "kosten_offline_tx_queue_v1";

export interface QueuedOfflineTransaction extends TransactionInput {
  clientTempId: string;
  queuedAt: string;
}

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
    clientTempId:
      tx.clientTempId ||
      `offline_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    queuedAt: new Date().toISOString(),
  };
  queue.push(item);
  await set(OFFLINE_QUEUE_KEY, queue);
  window.dispatchEvent(new CustomEvent("offline-queue-updated"));
  return item;
}

export async function removeOfflineTransactionFromQueue(
  clientTempId: string
): Promise<void> {
  const queue = await getOfflineQueue();
  const next = queue.filter((i) => i.clientTempId !== clientTempId);
  await set(OFFLINE_QUEUE_KEY, next);
  window.dispatchEvent(new CustomEvent("offline-queue-updated"));
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


/**
 * Entfernt beim Abmelden alle lokal zwischengespeicherten Finanzdaten:
 * Offline-Queue, Umsatz-Snapshot (IndexedDB) und die Laufzeit-Caches des
 * Service Workers (Seiten, RSC-Payloads, API-Antworten). Der Precache mit der
 * App-Hülle bleibt erhalten, damit die Offline-Seite weiter funktioniert.
 */
export async function clearLocalUserData(): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    await Promise.all([del(OFFLINE_QUEUE_KEY), del(OFFLINE_RECENT_TX_KEY)]);
  } catch {
    // IndexedDB nicht verfügbar
  }
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
  window.dispatchEvent(new CustomEvent("offline-queue-updated"));
}
