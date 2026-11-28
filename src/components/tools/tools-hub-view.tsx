"use client";

import { useState, useRef } from "react";
import { useConfirm } from "@/components/ui/use-confirm";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  FileSpreadsheet,
  FileText,
  Download,
  Upload,
  Play,
  Loader2,
  Landmark,
  ShieldCheck,
  CheckCircle2,
  HelpCircle,
  ArrowRight,
  Wallet,
  Copy,
  Database,
  RefreshCw,
  PackageCheck,
  AlertTriangle,
  BarChart3,
} from "lucide-react";
import {
  StatementImportModal,
  type AccountOptionItem,
} from "@/components/transactions/statement-import-modal";
import {
  applyCategoryRulesAction,
  seedDefaultCategoryRulesAction,
  toggleAllCategoryRulesAction,
  deleteAllCategoryRulesAction,
} from "@/actions/category-rule-actions";
import {
  findDuplicateTransactionsAction,
  type DuplicateGroup,
} from "@/actions/transaction-actions";
import { DuplicateFinderModal } from "./duplicate-finder-modal";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export function ToolsHubView({
  accounts = [],
  rulesCount = 0,
  activeRulesCount = 0,
  isAdmin = false,
  hasPaypalAccount = false,
}: {
  hasPaypalAccount?: boolean;
  accounts?: AccountOptionItem[];
  rulesCount?: number;
  activeRulesCount?: number;
  isAdmin?: boolean;
}) {
  const { confirm, confirmDialog } = useConfirm();
  const router = useRouter();
  const [modalOpen, setModalOpen] = useState(false);
  const [format, setFormat] = useState<"pdf" | "csv">("pdf");
  const [applyingRules, setApplyingRules] = useState(false);
  const [seedingRules, setSeedingRules] = useState(false);
  const [isTogglingRules, setIsTogglingRules] = useState(false);
  const [deleteRulesConfirm, setDeleteRulesConfirm] = useState(false);
  const [isDeletingRules, setIsDeletingRules] = useState(false);
  const [overwriteExisting, setOverwriteExisting] = useState(false);

  // Duplikate State
  const [duplicateModalOpen, setDuplicateModalOpen] = useState(false);
  const [duplicateGroups, setDuplicateGroups] = useState<DuplicateGroup[]>([]);
  const [checkingDuplicates, setCheckingDuplicates] = useState(false);

  // SQLite Restore State
  const [isRestoring, setIsRestoring] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleApplyRules() {
    setApplyingRules(true);
    try {
      const res = await applyCategoryRulesAction({ overwriteExisting });
      if (res.success) {
        toast.success(res.message);
      } else {
        toast.error(res.error || "Regeln konnten nicht angewendet werden.");
      }
    } catch {
      toast.error("Unerwarteter Fehler beim Anwenden der Regeln.");
    } finally {
      setApplyingRules(false);
    }
  }

  async function handleSeedRules() {
    setSeedingRules(true);
    try {
      const res = await seedDefaultCategoryRulesAction();
      if (res.success) {
        toast.success(res.message);
        router.refresh();
      } else {
        toast.error(res.error || "Fehler beim Aktivieren der Standard-Regeln.");
      }
    } catch {
      toast.error("Unerwarteter Fehler beim Aktivieren der Regeln.");
    } finally {
      setSeedingRules(false);
    }
  }

  async function handleCheckDuplicates() {
    setCheckingDuplicates(true);
    try {
      const res = await findDuplicateTransactionsAction();
      if (res.success) {
        setDuplicateGroups(res.groups);
        setDuplicateModalOpen(true);
        if (res.totalDuplicates === 0) {
          toast.success("Keine doppelten Buchungen gefunden. Alles sauber!");
        } else {
          toast.info(`${res.totalDuplicates} potenzielle Duplikate gefunden.`);
        }
      } else {
        toast.error(res.error || "Fehler bei der Duplikatsprüfung.");
      }
    } catch {
      toast.error("Unerwarteter Fehler bei der Duplikatssuche.");
    } finally {
      setCheckingDuplicates(false);
    }
  }

  async function handleRestoreFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (
      !(await confirm({ title: "Sicherung wiederherstellen?", confirmText: "Wiederherstellen", variant: "warning", message: `ACHTUNG: Möchtest du das Backup „${file.name}“ wirklich wiederherstellen? Die Datei wird geprüft und beim nächsten Neustart der App eingespielt. Vorhandene Daten werden dann ersetzt (der aktuelle Stand wird vorher automatisch gesichert).` }))
    ) {
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setIsRestoring(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/backup", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (res.ok && data.success) {
        toast.success(
          data.message ||
            "Sicherung vorgemerkt. Bitte App bzw. Container neu starten.",
          { duration: 15000 }
        );
      } else {
        toast.error(data.error || "Wiederherstellung fehlgeschlagen.");
      }
    } catch {
      toast.error("Fehler beim Upload des Backups.");
    } finally {
      setIsRestoring(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <div className="space-y-10 max-w-4xl mx-auto pb-16">
      {/* Page Header (Open Canvas) */}
      <div className="space-y-1 pb-4 border-b border-zinc-200/80 dark:border-zinc-800">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
          Werkzeuge & Datenverwaltung
        </h1>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Kontoauszüge importieren, Backups exportieren & Auto-Kategorisierungsregeln ausführen
        </p>
      </div>

      {/* 1. Kontoauszug & CSV Import */}
      <section className="space-y-4">
        <div className="flex items-center justify-between pb-2 border-b border-zinc-100 dark:border-zinc-800">
          <div>
            <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
              <FileSpreadsheet className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <span>Kontoauszüge & Transaktionen importieren</span>
            </h2>
            <p className="text-xs text-zinc-400">
              Lade originale PDF-Abrechnungen oder CSV-Dateien deiner Bank hoch
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div
            onClick={() => {
              setFormat("pdf");
              setModalOpen(true);
            }}
            className="p-5 rounded-lg border border-zinc-200/80 dark:border-zinc-800 hover:border-brand hover:bg-zinc-50/50 dark:hover:bg-zinc-900/50 transition cursor-pointer group space-y-2"
          >
            <div className="flex items-center justify-between">
              <div className="w-10 h-10 rounded-xl bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 flex items-center justify-center">
                <FileText className="w-5 h-5" />
              </div>
              <span className="text-xs font-semibold text-blue-600 dark:text-blue-400 group-hover:translate-x-0.5 transition-transform flex items-center gap-1">
                Öffnen <ArrowRight className="w-3 h-3" />
              </span>
            </div>
            <h3 className="font-bold text-sm text-zinc-900 dark:text-zinc-100">
              PDF-Kontoauszug hochladen
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
              Speziell optimiert für <strong>Advanzia Bank (Gebührenfrei Mastercard)</strong>, TF Bank
              und Standard-Bankauszüge. Tabellen werden clientseitig ohne externe Server ausgelesen.
            </p>
          </div>

          <div
            onClick={() => {
              setFormat("csv");
              setModalOpen(true);
            }}
            className="p-5 rounded-lg border border-zinc-200/80 dark:border-zinc-800 hover:border-brand hover:bg-zinc-50/50 dark:hover:bg-zinc-900/50 transition cursor-pointer group space-y-2"
          >
            <div className="flex items-center justify-between">
              <div className="w-10 h-10 rounded-xl bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 flex items-center justify-center">
                <FileSpreadsheet className="w-5 h-5" />
              </div>
              <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 group-hover:translate-x-0.5 transition-transform flex items-center gap-1">
                Öffnen <ArrowRight className="w-3 h-3" />
              </span>
            </div>
            <h3 className="font-bold text-sm text-zinc-900 dark:text-zinc-100">
              CSV-Datei importieren
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
              Unterstützt Sparkasse, ING, Deutsche Bank, Commerzbank, DKB, N26, PayPal & Standard-CSV.
              Inklusive automatischer Duplikatserkennung.
            </p>
          </div>
        </div>
      </section>

      {/* 2. Auto-Kategorisierungs-Zentrale */}
      <section className="space-y-4">
        <div className="flex items-center justify-between pb-2 border-b border-zinc-100 dark:border-zinc-800">
          <div>
            <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
              <span>Auto-Kategorisierungs-Zentrale</span>
            </h2>
            <p className="text-xs text-zinc-400">
              {rulesCount} definierte Regeln für Händler, Beschreibungen & Kostenarten
            </p>
          </div>
          <Link
            href="/categories?tab=rules"
            className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1"
          >
            <span>Regeln verwalten & bearbeiten</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Card: Standard-Regeln aktivieren / pausieren / verwalten */}
          <div className="p-5 rounded-lg border border-zinc-200/80 dark:border-zinc-800 space-y-3.5 flex flex-col justify-between">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <PackageCheck className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                  <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                    Standard-Regelpaket
                  </h3>
                </div>
                {rulesCount > 0 && (
                  <span
                    className={cn(
                      "text-xs font-bold px-2 py-0.5 rounded-full",
                      activeRulesCount > 0
                        ? "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 border border-emerald-500/20"
                        : "bg-zinc-500/10 text-zinc-500 dark:text-zinc-400 border border-zinc-500/20"
                    )}
                  >
                    {activeRulesCount > 0
                      ? `${activeRulesCount} von ${rulesCount} aktiv`
                      : "Pausiert"}
                  </span>
                )}
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
                Richtet ca. 25 bewährte deutsche Regeln für Supermärkte (REWE, Aldi, Edeka),
                Drogerien (dm, Rossmann), Tankstellen, ÖPNV, Streaming, GEZ & PayPal ein.
                Werden bei Bank-Sync und Datei-Importen automatisch angewendet.
              </p>
            </div>

            <div className="space-y-2 pt-1">
              {rulesCount === 0 ? (
                <button
                  type="button"
                  onClick={handleSeedRules}
                  disabled={seedingRules}
                  className="w-full px-4 py-2.5 rounded-xl bg-brand text-white hover:opacity-90 font-bold text-xs flex items-center justify-center gap-2 transition cursor-pointer disabled:opacity-50"
                >
                  {seedingRules ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <PackageCheck className="w-4 h-4" />
                  )}
                  <span>Standard-Regelpaket aktivieren</span>
                </button>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={async () => {
                        setIsTogglingRules(true);
                        const nextState = activeRulesCount === 0;
                        const res = await toggleAllCategoryRulesAction(nextState);
                        setIsTogglingRules(false);
                        if (res.success) {
                          toast.success(
                            nextState
                              ? "Alle Regeln aktiviert!"
                              : "Alle Regeln pausiert / deaktiviert."
                          );
                          router.refresh();
                        } else {
                          toast.error("Fehler beim Umschalten der Regeln.");
                        }
                      }}
                      disabled={isTogglingRules}
                      className={cn(
                        "px-3 py-2 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50",
                        activeRulesCount > 0
                          ? "bg-amber-500/10 hover:bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/20"
                          : "bg-brand text-white hover:opacity-90"
                      )}
                    >
                      {isTogglingRules ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : activeRulesCount > 0 ? (
                        <span>⏸️ Regeln pausieren</span>
                      ) : (
                        <span>▶️ Regeln aktivieren</span>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={handleSeedRules}
                      disabled={seedingRules}
                      className="px-3 py-2 rounded-xl bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 text-xs font-semibold transition flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                      title="Fehlende Standardregeln ergänzen"
                    >
                      {seedingRules ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="w-3.5 h-3.5" />
                      )}
                      <span>Regeln ergänzen</span>
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => setDeleteRulesConfirm(true)}
                    className="w-full text-center text-xs text-zinc-400 hover:text-red-600 dark:hover:text-red-400 transition cursor-pointer pt-0.5"
                  >
                    Alle {rulesCount} Regeln löschen / zurücksetzen
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Card: Regeln anwenden mit Schutz manueller Einträge */}
          <div className="p-5 rounded-lg border border-zinc-200/80 dark:border-zinc-800 space-y-3.5 flex flex-col justify-between">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Play className="w-4 h-4 text-blue-600 dark:text-blue-400 fill-blue-600 dark:fill-blue-400" />
                <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                  Regeln auf Buchungen anwenden
                </h3>
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
                Wendet deine aktiven Regeln rückwirkend an. Bereits manuell kategorisierte Buchungen
                werden standardmäßig geschützt und nicht überschrieben.
              </p>
              <label className="flex items-center gap-2 pt-1 text-xs text-zinc-600 dark:text-zinc-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={overwriteExisting}
                  onChange={(e) => setOverwriteExisting(e.target.checked)}
                  className="rounded border-zinc-300 text-blue-600 focus:ring-blue-500"
                />
                <span>Auch bereits manuell zugewiesene Kategorien überschreiben</span>
              </label>
            </div>
            <button
              type="button"
              onClick={handleApplyRules}
              disabled={applyingRules}
              className="w-full px-4 py-2.5 rounded-xl bg-brand text-white hover:opacity-90 font-bold text-xs flex items-center justify-center gap-2 transition cursor-pointer disabled:opacity-50"
            >
              {applyingRules ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Play className="w-4 h-4 fill-white" />
              )}
              <span>Regeln jetzt ausführen</span>
            </button>
          </div>
        </div>
      </section>

      {/* 3. Duplikats-Prüfer & Bereinigung */}
      <section className="space-y-4">
        <div className="flex items-center justify-between pb-2 border-b border-zinc-100 dark:border-zinc-800">
          <div>
            <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
              <Copy className="w-4 h-4 text-zinc-900 dark:text-zinc-100" />
              <span>Dubletten-Prüfer & Bereinigung</span>
            </h2>
            <p className="text-xs text-zinc-400">
              Spürt versehentlich doppelt erfasste oder importierte Buchungen auf
            </p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-5 rounded-lg border border-zinc-200/80 dark:border-zinc-800">
          <div className="space-y-0.5">
            <h3 className="font-bold text-sm text-zinc-900 dark:text-zinc-100">
              Doppelte Buchungen scannen
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Vergleicht Betrag, Händler und Buchungsdatum ($\pm 3$ Tage), um Duplikate zwischen Bar-Zahlungen,
              CSV-Dateien und Bank-Sync zu finden.
            </p>
          </div>
          <button
            type="button"
            onClick={handleCheckDuplicates}
            disabled={checkingDuplicates}
            className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-brand text-white hover:opacity-90 font-bold text-xs flex items-center justify-center gap-2 transition shrink-0 cursor-pointer disabled:opacity-50"
          >
            {checkingDuplicates ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Copy className="w-4 h-4" />
            )}
            <span>Auf Duplikate prüfen</span>
          </button>
        </div>
      </section>

      {/* 4. PayPal & Girokonto Abgleich-Ratgeber */}
      {/* PayPal-Abgleich: nur relevant, wenn ein PayPal-Konto geführt wird */}
      {hasPaypalAccount && (
      <section className="space-y-4">
          <div className="flex items-center justify-between pb-2 border-b border-zinc-100 dark:border-zinc-800">
            <div>
              <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                <Wallet className="w-4 h-4 text-zinc-900 dark:text-zinc-100" />
                <span>PayPal & Girokonto nahtlos abgleichen</span>
              </h2>
              <p className="text-xs text-zinc-400">
                Wie Zahlungen zwischen PayPal und deinem Girokonto neutral bleiben
              </p>
            </div>
          </div>
  
          <div className="p-5 rounded-lg bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-200/70 dark:border-zinc-800 space-y-3 text-xs text-zinc-600 dark:text-zinc-300">
            <p className="leading-relaxed">
              <strong>So funktioniert der Abgleich:</strong> PayPal bucht Zahlungen als Lastschrift von deinem
              Girokonto ab. Wenn du dein PayPal-Konto als manuelles Konto anlegst und die CSV-Umsätze von
              PayPal importierst:
            </p>
            <ul className="space-y-1.5 list-disc pl-5">
              <li>
                Die Lastschrift auf dem Girokonto wird als <strong>⇄ Umbuchung</strong> markiert
                (damit die Ausgabe nicht doppelt zählt). Aktiviere dafür in den Regeln
                „PayPal-Abbuchung als Umbuchung“.
              </li>
              <li>
                Die eigentlichen Einkäufe (z. B. Lieferando, Steam, eBay) liegen auf deinem PayPal-Konto
                und werden über deine <strong>Auto-Kategorisierungs-Regeln</strong> automatisch der passenden
                Kategorie zugeordnet.
              </li>
            </ul>
          </div>
        </section>
      )}

      {/* 5. Daten-Export & Vollständiges SQLite-Backup */}
      <section className="space-y-4">
        <div className="flex items-center justify-between pb-2 border-b border-zinc-100 dark:border-zinc-800">
          <div>
            <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
              <Database className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <span>Datenbank-Sicherung & Export</span>
            </h2>
            <p className="text-xs text-zinc-400">
              Sichere deine komplette SQLite-Datenbank oder exportiere CSV-Dateien
            </p>
          </div>
        </div>

        {isAdmin ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Jahresbericht */}
            <div className="p-5 rounded-lg border border-zinc-200/80 dark:border-zinc-800 space-y-3 flex flex-col justify-between">
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <BarChart3 className="w-4 h-4 text-zinc-900 dark:text-zinc-100" />
                    <h3 className="font-bold text-sm text-zinc-900 dark:text-zinc-100">
                      Jahresbericht
                    </h3>
                  </div>
                  <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 border border-purple-500/20">
                    Jahresbilanz
                  </span>
                </div>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
                  Umfassende Jahresauswertung mit 12-Monats-Verlauf, Sparquote, Ausgabenkategorien für die Einkommensteuererklärung und separatem Jahres-CSV-Download.
                </p>
              </div>
              <Link
                href="/reports"
                className="w-full px-4 py-2.5 rounded-xl bg-brand text-white hover:opacity-90 font-bold text-xs flex items-center justify-center gap-2 transition"
              >
                <BarChart3 className="w-4 h-4" />
                <span>Jahresreport öffnen</span>
              </Link>
            </div>

            {/* SQLite Backup Download */}
            <div className="p-5 rounded-lg border border-zinc-200/80 dark:border-zinc-800 space-y-3 flex flex-col justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Database className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  <h3 className="font-bold text-sm text-zinc-900 dark:text-zinc-100">
                    SQLite-Backup herunterladen
                  </h3>
                </div>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
                  Erstellt einen konsistenten Live-Snapshot deiner SQLite-Datenbank (`.sqlite`). Enthält alle Konten,
                  Buchungen, Kategorien und Einstellungen für sichere Server-Backups.
                </p>
              </div>
              <a
                href="/api/backup"
                download
                className="w-full px-4 py-2.5 rounded-xl bg-brand text-white hover:opacity-90 font-bold text-xs flex items-center justify-center gap-2 transition"
              >
                <Download className="w-4 h-4" />
                <span>Datenbank-Backup sichern</span>
              </a>
            </div>

            {/* SQLite Restore Upload */}
            <div className="p-5 rounded-lg border border-zinc-200/80 dark:border-zinc-800 space-y-3 flex flex-col justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Upload className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                  <h3 className="font-bold text-sm text-zinc-900 dark:text-zinc-100">
                    Backup wiederherstellen
                  </h3>
                </div>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
                  Stellt eine zuvor gesicherte `.sqlite`-Datei wieder her. Ein automatisches Sicherheits-Backup des
                  aktuellen Zustands wird vor dem Austausch angelegt.
                </p>
              </div>
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".sqlite,.db"
                  onChange={handleRestoreFile}
                  className="hidden"
                  id="restore-sqlite-file"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isRestoring}
                  className="w-full px-4 py-2.5 rounded-xl border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-800 dark:text-zinc-200 font-bold text-xs flex items-center justify-center gap-2 transition cursor-pointer disabled:opacity-50"
                >
                  {isRestoring ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Upload className="w-4 h-4" />
                  )}
                  <span>.sqlite Backup einspielen</span>
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="p-4 rounded-lg bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-200/80 dark:border-zinc-800 text-xs text-zinc-500 dark:text-zinc-400 flex items-center gap-2.5">
            <Database className="w-4 h-4 text-zinc-400 shrink-0" />
            <span>
              Vollständige SQLite-Datenbank-Snapshots und Wiederherstellungen sind aus Sicherheitsgründen Administratoren vorbehalten. Für deine Buchungen steht der CSV-Export bereit.
            </span>
          </div>
        )}

        {/* CSV Export Card */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-5 rounded-lg border border-zinc-200/80 dark:border-zinc-800">
          <div className="space-y-0.5">
            <h3 className="font-bold text-sm text-zinc-900 dark:text-zinc-100">
              CSV-Export aller Transaktionen
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Kompatibel mit Excel, Google Sheets und Numbers.
            </p>
          </div>
          <a
            href="/api/csv/export"
            download
            className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-brand text-white hover:opacity-90 font-bold text-xs flex items-center justify-center gap-2 transition shrink-0"
          >
            <Download className="w-4 h-4" />
            <span>CSV herunterladen</span>
          </a>
        </div>
      </section>

      {/* Duplicate Finder Modal */}
      <DuplicateFinderModal
        open={duplicateModalOpen}
        onClose={() => setDuplicateModalOpen(false)}
        groups={duplicateGroups}
        onResolved={() => router.refresh()}
      />

      {/* Statement Import Modal */}
      <StatementImportModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        accounts={accounts}
        defaultFormat={format}
      />

      {/* Confirm Modal für Regeln löschen */}
      <ConfirmModal
        open={deleteRulesConfirm}
        title="Alle Auto-Kategorisierungsregeln löschen"
        message={`Möchtest du wirklich alle ${rulesCount} Regeln unwiderruflich löschen? Bestehende Buchungen behalten ihre Kategorien, aber künftige Syncs und Importe werden nicht mehr automatisch zugeordnet.`}
        confirmText="Alle Regeln löschen"
        cancelText="Abbrechen"
        variant="danger"
        loading={isDeletingRules}
        onCancel={() => setDeleteRulesConfirm(false)}
        onConfirm={async () => {
          setIsDeletingRules(true);
          try {
            const res = await deleteAllCategoryRulesAction();
            if (res.success) {
              toast.success("Alle Regeln erfolgreich gelöscht.");
              setDeleteRulesConfirm(false);
              router.refresh();
            } else {
              toast.error("Fehler beim Löschen der Regeln.");
            }
          } catch {
            toast.error("Unerwarteter Fehler.");
          } finally {
            setIsDeletingRules(false);
          }
        }}
      />
      {confirmDialog}
    </div>
  );
}
