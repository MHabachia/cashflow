"use client";

import { useEffect, useId, useRef } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Stapel geöffneter Dialoge: nur der oberste reagiert auf Escape/Tab
const dialogStack: symbol[] = [];

/**
 * Barrierefreiheit für selbstgebaute Modals:
 * - role="dialog", aria-modal und Verknüpfung mit der Überschrift
 * - Escape schließt den Dialog
 * - Fokus wandert beim Öffnen in den Dialog, bleibt per Tab darin und
 *   springt beim Schließen auf das auslösende Element zurück
 *
 * Verwendung:
 *   const { dialogProps, titleId } = useDialogA11y({ open, onClose });
 *   <div {...dialogProps}><h2 id={titleId}>…</h2>…</div>
 */
export function useDialogA11y({
  open = true,
  onClose,
  closeOnEscape = true,
}: {
  open?: boolean;
  onClose?: () => void;
  closeOnEscape?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const token = Symbol("dialog");
    dialogStack.push(token);
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const container = ref.current;

    // Fokus in den Dialog setzen (erstes Eingabefeld bevorzugt)
    const focusTarget =
      container?.querySelector<HTMLElement>("input:not([type=hidden]), select, textarea") ??
      container?.querySelector<HTMLElement>(FOCUSABLE) ??
      container;
    focusTarget?.focus({ preventScroll: true });

    function onKeyDown(e: KeyboardEvent) {
      if (!container || dialogStack[dialogStack.length - 1] !== token) return;
      if (e.key === "Escape" && closeOnEscape && onCloseRef.current) {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const focusable = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null
      );
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      const idx = dialogStack.indexOf(token);
      if (idx !== -1) dialogStack.splice(idx, 1);
      if (previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus({ preventScroll: true });
      }
    };
  }, [open, closeOnEscape]);

  return {
    titleId,
    dialogProps: {
      ref,
      role: "dialog" as const,
      "aria-modal": true as const,
      "aria-labelledby": titleId,
      tabIndex: -1,
    },
  };
}
