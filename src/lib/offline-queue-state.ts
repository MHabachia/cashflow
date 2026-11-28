import type { TransactionInput } from "@/actions/transaction-actions";

/**
 * Reine Zustandslogik der Offline-Queue, ohne Browser-Speicher, damit sie
 * sich ohne IndexedDB testen lässt. Gespeichert wird in `offline-queue.ts`.
 */

export interface QueuedOfflineTransaction extends TransactionInput {
  clientTempId: string;
  queuedAt: string;
  /** Gesetzt, wenn der Server den Eintrag abgelehnt hat; wird nicht automatisch erneut gesendet */
  rejectedAt?: string;
  rejectionReason?: string;
}

/**
 * ID zur Deduplizierung auf dem Server. `crypto.randomUUID` gibt es nur in
 * sicheren Kontexten (HTTPS, localhost); im Heimnetz per http:// fehlt es,
 * `getRandomValues` ist dort weiterhin verfügbar.
 */
export function createClientTempId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function isRejected(item: QueuedOfflineTransaction): boolean {
  return Boolean(item.rejectedAt);
}

/** Einträge, die bei der nächsten Verbindung automatisch übertragen werden. */
export function pendingItems(queue: QueuedOfflineTransaction[]): QueuedOfflineTransaction[] {
  return queue.filter((item) => !isRejected(item));
}

export function rejectedItems(queue: QueuedOfflineTransaction[]): QueuedOfflineTransaction[] {
  return queue.filter(isRejected);
}

export function withRejection(
  queue: QueuedOfflineTransaction[],
  clientTempId: string,
  reason: string,
  now: Date = new Date()
): QueuedOfflineTransaction[] {
  return queue.map((item) =>
    item.clientTempId === clientTempId
      ? { ...item, rejectedAt: now.toISOString(), rejectionReason: reason }
      : item
  );
}

/** Hebt die Ablehnung auf, damit der Eintrag erneut gesendet wird. */
export function withRetry(queue: QueuedOfflineTransaction[], clientTempId: string): QueuedOfflineTransaction[] {
  return queue.map((item) => {
    if (item.clientTempId !== clientTempId) return item;
    const { rejectedAt: _rejectedAt, rejectionReason: _rejectionReason, ...rest } = item;
    return rest;
  });
}

export function without(queue: QueuedOfflineTransaction[], clientTempId: string): QueuedOfflineTransaction[] {
  return queue.filter((item) => item.clientTempId !== clientTempId);
}

/** Nur die Felder, die der Server erwartet (ohne Queue-Metadaten). */
export function toTransactionInput(item: QueuedOfflineTransaction): TransactionInput {
  const { queuedAt: _queuedAt, rejectedAt: _rejectedAt, rejectionReason: _rejectionReason, ...input } = item;
  return input;
}
