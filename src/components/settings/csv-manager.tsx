"use client";

import { useState } from "react";
import { Download, FileSpreadsheet, FileText } from "lucide-react";
import {
  StatementImportModal,
  type AccountOptionItem,
} from "@/components/transactions/statement-import-modal";

export function CsvManager({
  accounts = [],
}: {
  accounts?: AccountOptionItem[];
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const [format, setFormat] = useState<"pdf" | "csv">("pdf");

  return (
    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-5 space-y-4">
      <div className="flex items-center gap-2">
        <FileSpreadsheet className="w-5 h-5 text-blue-600" />
        <h2 className="font-bold text-base">Umsätze & Kontoauszüge importieren (CSV & PDF)</h2>
      </div>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Exportiere alle deine Buchungen als CSV oder importiere bestehende
        Umsätze direkt aus CSV-Dateien oder originalen Bank- und Kreditkarten-PDF-Kontoauszügen
        (z.&nbsp;B. Advanzia Gebührenfrei, ING, Sparkasse) mit Zuordnung zu deinen Konten.
      </p>

      <div className="grid sm:grid-cols-3 gap-2.5">
        <button
          type="button"
          onClick={() => {
            setFormat("pdf");
            setModalOpen(true);
          }}
          className="py-2.5 px-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-xs font-semibold flex items-center justify-center gap-2 transition cursor-pointer"
        >
          <FileText className="w-4 h-4 text-rose-500" />
          <span>PDF-Abrechnung</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setFormat("csv");
            setModalOpen(true);
          }}
          className="py-2.5 px-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-xs font-semibold flex items-center justify-center gap-2 transition cursor-pointer"
        >
          <FileSpreadsheet className="w-4 h-4 text-emerald-500" />
          <span>CSV-Datei</span>
        </button>

        <a
          href="/api/csv/export"
          download
          className="py-2.5 px-3 rounded-xl bg-brand text-white hover:opacity-90 text-xs font-semibold flex items-center justify-center gap-2 transition"
        >
          <Download className="w-4 h-4" />
          <span>Als CSV exportieren</span>
        </a>
      </div>

      <div className="p-3 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200/70 dark:border-zinc-800 text-xs text-zinc-500 space-y-1">
        <div className="flex items-center gap-1.5 font-semibold text-zinc-700 dark:text-zinc-300">
          <FileText className="w-3.5 h-3.5 text-blue-600" />
          <span>Direkter PDF- & CSV-Support mit Kontozuordnung:</span>
        </div>
        <p>
          Du kannst direkt eine <strong>PDF-Monatsabrechnung</strong> (z.&nbsp;B. von der Advanzia Bank) hochladen und einem bestimmten Konto (z. B. Advanzia Mastercard) zuweisen.
          Cashflow liest die Umsatztabelle automatisch aus und schreibt den Saldo auf Wunsch direkt fort.
        </p>
        <p className="pt-1 text-xs text-zinc-400">
          Bereits vorhandene Buchungen werden dank Duplikatserkennung automatisch übersprungen.
        </p>
      </div>

      <StatementImportModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        accounts={accounts}
        defaultFormat={format}
      />
    </div>
  );
}
