"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { openConfirm, type ConfirmOptions, type PendingConfirm } from "@/lib/confirm-request";

/**
 * Ersatz für window.confirm() mit dem App-eigenen Dialog (Fokus, Escape,
 * Kennzeichnung gefährlicher Aktionen).
 *
 * Verwendung:
 *   const { confirm, confirmDialog } = useConfirm();
 *   if (!(await confirm({ message: "Wirklich löschen?", variant: "danger" }))) return;
 *   …
 *   return <>…{confirmDialog}</>;
 */
export function useConfirm() {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const pendingRef = useRef<PendingConfirm | null>(null);

  const confirm = useCallback((options: ConfirmOptions) => {
    const { next, promise } = openConfirm(pendingRef.current, options);
    pendingRef.current = next;
    setPending(next);
    return promise;
  }, []);

  const close = useCallback((confirmed: boolean) => {
    pendingRef.current?.settle(confirmed);
    pendingRef.current = null;
    setPending(null);
  }, []);

  // Verschwindet die Komponente mit offener Rückfrage, gilt sie als abgebrochen
  useEffect(() => () => pendingRef.current?.settle(false), []);

  const options = pending?.options;
  const confirmDialog = (
    <ConfirmModal
      open={pending !== null}
      title={options?.title ?? "Bestätigung erforderlich"}
      message={options?.message ?? ""}
      confirmText={options?.confirmText ?? "Bestätigen"}
      cancelText={options?.cancelText ?? "Abbrechen"}
      variant={options?.variant ?? "primary"}
      onConfirm={() => close(true)}
      onCancel={() => close(false)}
    />
  );

  return { confirm, confirmDialog };
}
