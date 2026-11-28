/**
 * Promise-Logik für Rückfragen (useConfirm), ohne React, damit sie testbar ist.
 * Jede Rückfrage wird genau einmal beantwortet; eine neue ersetzt eine noch
 * offene, die dann als „abgebrochen“ gilt.
 */

export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: "danger" | "warning" | "primary";
}

export interface PendingConfirm {
  options: ConfirmOptions;
  settle: (confirmed: boolean) => void;
}

export function openConfirm(
  current: PendingConfirm | null,
  options: ConfirmOptions
): { next: PendingConfirm; promise: Promise<boolean> } {
  current?.settle(false);
  let resolve!: (confirmed: boolean) => void;
  const promise = new Promise<boolean>((r) => {
    resolve = r;
  });
  let settled = false;
  const next: PendingConfirm = {
    options,
    settle: (confirmed) => {
      if (settled) return;
      settled = true;
      resolve(confirmed);
    },
  };
  return { next, promise };
}
