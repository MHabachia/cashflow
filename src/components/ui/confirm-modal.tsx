"use client";

import { AlertTriangle, Trash2, X } from "lucide-react";
import { useDialogA11y } from "@/lib/use-dialog-a11y";
import { cn } from "@/lib/utils";

export function ConfirmModal({
  open,
  title = "Bestätigung erforderlich",
  message,
  confirmText = "Löschen",
  cancelText = "Abbrechen",
  variant = "danger",
  onConfirm,
  onCancel,
  loading = false,
}: {
  open: boolean;
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: "danger" | "warning" | "primary";
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
  loading?: boolean;
}) {
  const { dialogProps, titleId } = useDialogA11y({ open, onClose: onCancel });
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div {...dialogProps} className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl w-full max-w-sm shadow-2xl overflow-hidden p-6 space-y-4 animate-in zoom-in-95 duration-150">
        <div className="flex items-start gap-3.5">
          <div
            className={cn(
              "w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 shadow-xs",
              variant === "danger"
                ? "bg-red-500/10 text-red-600 dark:text-red-400"
                : variant === "warning"
                ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                : "bg-blue-500/10 text-blue-600 dark:text-blue-400"
            )}
          >
            {variant === "danger" ? (
              <Trash2 className="w-5 h-5" />
            ) : (
              <AlertTriangle className="w-5 h-5" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h3 id={titleId} className="font-extrabold text-base text-zinc-900 dark:text-zinc-100">
              {title}
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 leading-relaxed">
              {message}
            </p>
          </div>
          <button
            aria-label="Schließen"
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition rounded-lg"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="px-4 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-xs font-semibold text-zinc-700 dark:text-zinc-300 transition cursor-pointer"
          >
            {cancelText}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className={cn(
              "px-4 py-2 rounded-xl text-white text-xs font-bold transition shadow-xs cursor-pointer flex items-center gap-1.5 disabled:opacity-50",
              variant === "danger"
                ? "bg-red-600 hover:bg-red-700 active:bg-red-800 shadow-red-600/20"
                : "bg-blue-600 hover:bg-blue-700 active:bg-blue-800 shadow-blue-600/20"
            )}
          >
            {loading && <span className="animate-spin">⏳</span>}
            <span>{confirmText}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
