"use client";

import { useState, useRef } from "react";
import { useDialogA11y } from "@/lib/use-dialog-a11y";
import {
  X,
  Upload,
  FileText,
  FileSpreadsheet,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Landmark,
  CreditCard,
  Coins,
  PiggyBank,
} from "lucide-react";
import { toast } from "sonner";
import { importStatementFileAction } from "@/actions/csv-actions";
import { formatCents } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface AccountOptionItem {
  id: string;
  accountName: string;
  ibanMasked?: string | null;
  accountType?: "checking" | "credit_card" | "savings" | "cash" | string | null;
  balanceCents?: number | null;
  institutionName?: string | null;
}

interface StatementImportModalProps {
  open: boolean;
  onClose: () => void;
  accounts: AccountOptionItem[];
  defaultFormat?: "pdf" | "csv";
  defaultAccountId?: string;
  onSuccess?: () => void;
}

export function StatementImportModal({
  open,
  onClose,
  accounts = [],
  defaultFormat = "pdf",
  defaultAccountId,
  onSuccess,
}: StatementImportModalProps) {
  const [activeFormat, setActiveFormat] = useState<"pdf" | "csv">(defaultFormat);
  const [selectedAccountId, setSelectedAccountId] = useState<string>(
    defaultAccountId || "auto"
  );
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [updateBalance, setUpdateBalance] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { dialogProps, titleId } = useDialogA11y({ open, onClose: onClose });
  if (!open) return null;

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedFile) {
      toast.error("Bitte wähle eine Datei zum Importieren aus.");
      return;
    }

    setIsSubmitting(true);
    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      if (selectedAccountId && selectedAccountId !== "auto") {
        formData.append("bankAccountId", selectedAccountId);
      }
      formData.append("updateBalance", updateBalance ? "true" : "false");

      const res = await importStatementFileAction(formData);
      if (res.success) {
        const typeLabel =
          res.format === "pdf" ? "PDF-Kontoauszug" : res.format === "camt" ? "CAMT-Kontoauszug" : "CSV-Datei";
        toast.success(
          `${res.importedCount} Buchungen erfolgreich aus ${typeLabel} importiert${
            res.skippedDuplicates
              ? ` (${res.skippedDuplicates} Duplikate übersprungen)`
              : ""
          }!`
        );
        onClose();
        if (onSuccess) onSuccess();
      } else {
        toast.error(res.error || "Import fehlgeschlagen.");
      }
    } catch {
      toast.error("Unerwarteter Fehler beim Verarbeiten der Datei.");
    } finally {
      setIsSubmitting(false);
    }
  }

  const selectedAccount = accounts.find((a) => a.id === selectedAccountId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 duration-150">
      <div {...dialogProps} className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl w-full max-w-lg shadow-lg overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-5 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 flex items-center justify-center">
              <Upload className="w-5 h-5" />
            </div>
            <div>
              <h2 id={titleId} className="text-base font-bold text-zinc-900 dark:text-zinc-100">
                Kontoauszug & Umsätze importieren
              </h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Kontoauszüge einlesen und gezielt einem Bankkonto zuordnen.
              </p>
            </div>
          </div>
          <button
            aria-label="Schließen"
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4 overflow-y-auto">
          {/* Format-Auswahl (PDF vs CSV) */}
          <div>
            <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1.5">
              1. Dateiformat wählen
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  setActiveFormat("pdf");
                  setSelectedFile(null);
                  if (fileInputRef.current) fileInputRef.current.value = "";
                }}
                className={cn(
                  "flex items-center gap-2.5 p-3 rounded-lg border text-xs font-semibold transition cursor-pointer text-left",
                  activeFormat === "pdf"
                    ? "border-rose-500/80 bg-rose-50/70 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300 "
                    : "border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 text-zinc-600 dark:text-zinc-400"
                )}
              >
                <div
                  className={cn(
                    "w-8 h-8 rounded-xl flex items-center justify-center shrink-0",
                    activeFormat === "pdf"
                      ? "bg-rose-600 text-white"
                      : "bg-zinc-100 dark:bg-zinc-800 text-zinc-500"
                  )}
                >
                  <FileText className="w-4 h-4" />
                </div>
                <div>
                  <div className="font-bold">PDF-Kontoauszug</div>
                  <div className="text-xs font-normal opacity-80">
                    Advanzia, TF Bank, Girokonto
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => {
                  setActiveFormat("csv");
                  setSelectedFile(null);
                  if (fileInputRef.current) fileInputRef.current.value = "";
                }}
                className={cn(
                  "flex items-center gap-2.5 p-3 rounded-lg border text-xs font-semibold transition cursor-pointer text-left",
                  activeFormat === "csv"
                    ? "border-emerald-500/80 bg-emerald-50/70 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 "
                    : "border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 text-zinc-600 dark:text-zinc-400"
                )}
              >
                <div
                  className={cn(
                    "w-8 h-8 rounded-xl flex items-center justify-center shrink-0",
                    activeFormat === "csv"
                      ? "bg-brand text-white"
                      : "bg-zinc-100 dark:bg-zinc-800 text-zinc-500"
                  )}
                >
                  <FileSpreadsheet className="w-4 h-4" />
                </div>
                <div>
                  <div className="font-bold">CSV / CAMT</div>
                  <div className="text-xs font-normal opacity-80">
                    Bank-CSV oder CAMT.053 (XML)
                  </div>
                </div>
              </button>
            </div>
          </div>

          {/* Zielkonto-Auswahl (Dropdown) */}
          <div>
            <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
              2. Konto oder Kreditkarte zuordnen
            </label>
            <select
              value={selectedAccountId}
              onChange={(e) => setSelectedAccountId(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900 text-xs focus:ring-2 focus:ring-blue-500 outline-hidden transition"
            >
              <option value="auto">
                Automatisch erkennen (z. B. Advanzia Mastercard)
              </option>
              {accounts.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {acc.accountName}{" "}
                  {acc.ibanMasked ? `(${acc.ibanMasked})` : ""}{" "}
                  {acc.balanceCents !== null && acc.balanceCents !== undefined
                    ? `· Saldo: ${formatCents(acc.balanceCents)}`
                    : ""}
                </option>
              ))}
            </select>
            <span className="text-xs text-zinc-400 mt-1 block">
              Alle importierten Buchungen werden diesem Konto zugeordnet.
            </span>
          </div>

          {/* Datei Upload / Dropzone */}
          <div>
            <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
              3. Datei hochladen ({activeFormat.toUpperCase()})
            </label>

            <input
              ref={fileInputRef}
              type="file"
              accept={
                activeFormat === "pdf"
                  ? ".pdf,application/pdf"
                  : ".csv,text/csv,text/comma-separated-values,.xml,application/xml,text/xml"
              }
              onChange={handleFileChange}
              className="hidden"
            />

            <div
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                "p-5 rounded-lg border-2 border-dashed flex flex-col items-center justify-center text-center cursor-pointer transition",
                selectedFile
                  ? "border-blue-500/60 bg-blue-50/30 dark:bg-blue-950/20"
                  : "border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 bg-zinc-50/50 dark:bg-zinc-900/50"
              )}
            >
              {selectedFile ? (
                <div className="space-y-1.5">
                  <div className="w-10 h-10 rounded-xl bg-brand text-white flex items-center justify-center mx-auto">
                    {activeFormat === "pdf" ? (
                      <FileText className="w-5 h-5" />
                    ) : (
                      <FileSpreadsheet className="w-5 h-5" />
                    )}
                  </div>
                  <div className="font-semibold text-xs text-zinc-900 dark:text-zinc-100 max-w-xs truncate">
                    {selectedFile.name}
                  </div>
                  <div className="text-xs text-zinc-400">
                    {(selectedFile.size / 1024).toFixed(1)} KB · Klicken zum Ändern
                  </div>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <div className="w-10 h-10 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-400 flex items-center justify-center mx-auto">
                    <Upload className="w-5 h-5" />
                  </div>
                  <div className="font-semibold text-xs text-zinc-800 dark:text-zinc-200">
                    Klicken, um {activeFormat.toUpperCase()}-Datei auszuwählen
                  </div>
                  <div className="text-xs text-zinc-400 max-w-xs">
                    {activeFormat === "pdf"
                      ? "Unterstützt originale Monatsabrechnungen der Advanzia Bank, TF Bank, ING etc."
                      : "Unterstützt CSV-Dateien mit Datum, Betrag und Verwendungszweck"}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Saldo automatisch aktualisieren Checkbox */}
          {selectedAccountId !== "auto" && (
            <label className="flex items-start gap-2.5 p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-100 dark:border-zinc-800 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={updateBalance}
                onChange={(e) => setUpdateBalance(e.target.checked)}
                className="mt-0.5 rounded border-zinc-300 text-blue-600 focus:ring-blue-500"
              />
              <div>
                <span className="font-semibold text-zinc-800 dark:text-zinc-200">
                  Saldo des gewählten Kontos automatisch fortschreiben
                </span>
                <p className="text-xs text-zinc-400 mt-0.5 leading-relaxed">
                  Passt den Kontostand von „{selectedAccount?.accountName}“ um die Summe
                  der importierten Umsätze an.
                </p>
              </div>
            </label>
          )}

          {/* Duplikatschutz-Hinweis */}
          <div className="p-3 rounded-xl bg-blue-50/50 dark:bg-blue-950/30 border border-blue-200/50 dark:border-blue-900/40 text-xs text-blue-900 dark:text-blue-300 leading-relaxed">
            <strong>Idempotenter Duplikatschutz:</strong> Bereits vorhandene
            Buchungen werden anhand von Datum, Betrag und Verwendungszweck automatisch
            erkannt und ohne Duplikate übersprungen.
          </div>

          {/* Footer Actions */}
          <div className="pt-3 border-t border-zinc-100 dark:border-zinc-800 flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 rounded-xl text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800 transition cursor-pointer"
            >
              Abbrechen
            </button>
            <button
              type="submit"
              disabled={!selectedFile || isSubmitting}
              className="px-4 py-2 rounded-xl bg-brand text-white hover:opacity-90 text-xs font-bold transition cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
            >
              {isSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>Jetzt importieren</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
