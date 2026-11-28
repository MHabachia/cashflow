"use client";

import { useState, useMemo, useRef, useEffect, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  deleteTransactionAction,
  batchUpdateTransactionsAction,
  batchDeleteTransactionsAction,
} from "@/actions/transaction-actions";
import { importStatementFileAction } from "@/actions/csv-actions";
import {
  createCategoryRuleAction,
  applyCategoryRulesAction,
} from "@/actions/category-rule-actions";
import { saveRecentTransactionsSnapshot, type CachedTransactionSnapshot } from "@/lib/offline-queue";
import { BANK_TRANSACTION_DELETE_ERROR } from "@/lib/transaction-messages";
import {
  formatCents,
  formatDateDE,
  PAYMENT_METHOD_LABELS,
  todayISO,
  shiftedLocalISODate,
} from "@/lib/format";
import { CategoryIcon } from "@/components/ui/category-icon";
import {
  QuickAddModal,
  type CategoryItem,
  type VariablePresetItem,
  type EditableTransaction,
} from "@/components/transactions/quick-add-modal";
import {
  CreateRecurringModal,
  type PrefillRecurringData,
} from "@/components/recurring/create-recurring-modal";
import { StatementImportModal } from "./statement-import-modal";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { SplitTransactionModal } from "./split-modal";
import type { PaymentMethod } from "@/lib/db/schema";
import {
  Search,
  Plus,
  Pencil,
  Trash2,
  Filter,
  ListFilter,
  Repeat,
  ListOrdered,
  Image as ImageIcon,
  Download,
  Upload,
  ChevronDown,
  FileText,
  FileSpreadsheet,
  Landmark,
  CreditCard,
  Calendar,
  GitFork,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface TransactionRow {
  id: string;
  categoryId: string;
  type: "expense" | "income";
  costType: "variable" | "fixed" | "transfer";
  amountCents: number;
  date: string;
  description: string;
  merchant: string | null;
  paymentMethod: PaymentMethod;
  receiptPath: string | null;
  isSplit?: boolean;
  bankAccountId?: string | null;
  bankAccountName?: string | null;
  /** Von der Bank übernommen: nicht löschbar (siehe deleteTransactionAction) */
  isBankSynced?: boolean;
}

function formatDateGroupHeader(dateStr: string): string {
  const today = todayISO();
  const yesterday = shiftedLocalISODate(-1);

  if (dateStr === today) {
    return `Heute (${formatDateDE(dateStr)})`;
  }
  if (dateStr === yesterday) {
    return `Gestern (${formatDateDE(dateStr)})`;
  }
  return formatDateDE(dateStr);
}

export function TransactionsView({
  transactions,
  selectedMonth,
  availableMonths,
  recentTransactions,
  categories,
  presets,
  bankAccounts = [],
}: {
  /** Nur die Buchungen von `selectedMonth` (bzw. alle bei "all") */
  transactions: TransactionRow[];
  selectedMonth: string;
  availableMonths: string[];
  recentTransactions: CachedTransactionSnapshot[];
  categories: (CategoryItem & { isArchived?: boolean })[];
  presets: VariablePresetItem[];
  bankAccounts?: Array<{
    id: string;
    accountName: string;
    ibanMasked?: string | null;
    institutionName?: string | null;
  }>;
}) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [monthChangePending, startMonthChange] = useTransition();

  // Der Monat steht in der URL, damit der Server nur diesen Monat lädt
  function changeMonth(month: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("quickAdd");
    params.set("month", month);
    startMonthChange(() => router.push(`${pathname}?${params.toString()}`));
  }

  useEffect(() => {
    if (searchParams.get("quickAdd") === "1") {
      window.dispatchEvent(new CustomEvent("open-quick-add"));
    }
  }, [searchParams]);

  // Lokalen IndexedDB-Snapshot der letzten Buchungen für die Offline-Ansicht
  // aktualisieren; unabhängig vom gewählten Monat immer die neuesten
  useEffect(() => {
    if (recentTransactions.length > 0) {
      saveRecentTransactionsSnapshot(recentTransactions);
    }
  }, [recentTransactions]);

  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [selectedCostType, setSelectedCostType] = useState<
    "all" | "variable" | "fixed"
  >("all");
  const [selectedBankAccountId, setSelectedBankAccountId] = useState<string>(
    searchParams.get("bankAccountId") || "all"
  );
  // Filter über Seitenwechsel hinweg merken (nur für diese Browser-Sitzung)
  const FILTER_KEY = "cashflow_tx_filters_v1";
  const [filtersRestored, setFiltersRestored] = useState(false);
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(FILTER_KEY);
      if (raw) {
        const f = JSON.parse(raw) as {
          search?: string;
          category?: string;
          costType?: "all" | "variable" | "fixed";
          bankAccountId?: string;
        };
        if (f.search) setSearch(f.search);
        if (f.category) setSelectedCategory(f.category);
        if (f.costType) setSelectedCostType(f.costType);
        if (f.bankAccountId && !searchParams.get("bankAccountId")) setSelectedBankAccountId(f.bankAccountId);
      }
    } catch {
      /* ungültiger Eintrag */
    }
    setFiltersRestored(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!filtersRestored) return;
    try {
      sessionStorage.setItem(
        FILTER_KEY,
        JSON.stringify({
          search,
          category: selectedCategory,
          costType: selectedCostType,
          bankAccountId: selectedBankAccountId,
        })
      );
    } catch {
      /* Speicher nicht verfügbar */
    }
  }, [filtersRestored, search, selectedCategory, selectedCostType, selectedBankAccountId]);
  const hasActiveFilters =
    search !== "" || selectedCategory !== "all" || selectedCostType !== "all" || selectedBankAccountId !== "all";
  function resetFilters() {
    setSearch("");
    setSelectedCategory("all");
    setSelectedCostType("all");
    setSelectedBankAccountId("all");
  }

  const [editingTx, setEditingTx] = useState<EditableTransaction | null>(null);
  const [splitTxModal, setSplitTxModal] = useState<TransactionRow | null>(null);
  const [recurringPrefill, setRecurringPrefill] = useState<PrefillRecurringData | null>(null);
  const [statementImportModalOpen, setStatementImportModalOpen] = useState(false);
  const [statementImportFormat, setStatementImportFormat] = useState<"pdf" | "csv">("pdf");
  // Zum Löschen vorgemerkte Zeilen (Rückgängig-Frist)
  const [pendingDeleteIds, setPendingDeleteIds] = useState<Set<string>>(new Set());
  const [swipedId, setSwipedId] = useState<string | null>(null);
  const touchStartX = useRef<number | null>(null);

  // Inkrementelle Paginierung / Lazy Chunk Loading
  const INITIAL_VISIBLE_COUNT = 30;
  const CHUNK_SIZE = 30;
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_COUNT);

  useEffect(() => {
    setVisibleCount(INITIAL_VISIBLE_COUNT);
  }, [
    selectedMonth,
    search,
    selectedCategory,
    selectedCostType,
    selectedBankAccountId,
  ]);

  // Batch-Auswahl State & Aktionen
  const [selectedTxIds, setSelectedTxIds] = useState<Set<string>>(new Set());
  const [isBatchUpdating, setIsBatchUpdating] = useState(false);

  function toggleSelectTx(id: string) {
    setSelectedTxIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleSelectAll() {
    if (selectedTxIds.size === filteredTransactions.length) {
      setSelectedTxIds(new Set());
    } else {
      setSelectedTxIds(new Set(filteredTransactions.map((t) => t.id)));
    }
  }

  async function handleBatchAssignCategory(catId: string) {
    if (selectedTxIds.size === 0 || !catId) return;
    setIsBatchUpdating(true);
    try {
      const res = await batchUpdateTransactionsAction({
        ids: Array.from(selectedTxIds),
        categoryId: catId,
      });
      if (res.success) {
        toast.success(`${res.count} Buchungen erfolgreich der Kategorie zugewiesen.`);
        setSelectedTxIds(new Set());
      } else {
        toast.error(res.error || "Aktualisierung fehlgeschlagen.");
      }
    } catch {
      toast.error("Fehler bei der Massenaktualisierung.");
    } finally {
      setIsBatchUpdating(false);
    }
  }

  async function handleBatchSetCostType(costType: "variable" | "fixed" | "transfer") {
    if (selectedTxIds.size === 0) return;
    setIsBatchUpdating(true);
    try {
      const res = await batchUpdateTransactionsAction({
        ids: Array.from(selectedTxIds),
        costType,
      });
      if (res.success) {
        toast.success(
          `${res.count} Buchungen auf „${
            costType === "fixed" ? "Fixkosten" : costType === "transfer" ? "Umbuchung" : "Variabel"
          }“ umgestellt.`
        );
        setSelectedTxIds(new Set());
      } else {
        toast.error(res.error || "Aktualisierung fehlgeschlagen.");
      }
    } catch {
      toast.error("Fehler bei der Massenaktualisierung.");
    } finally {
      setIsBatchUpdating(false);
    }
  }

  // Eigener Lösch-Bestätigungsdialog (anstatt nativer Browser-Confirm)
  const [deleteConfirm, setDeleteConfirm] = useState<{
    type: "single" | "batch";
    id?: string;
  } | null>(null);
  const [isDeletingTx, setIsDeletingTx] = useState(false);

  function handleBatchDelete() {
    if (selectedTxIds.size === 0) return;
    setDeleteConfirm({ type: "batch" });
  }

  // Auto-Kategorisierungsregel Modal State
  const [ruleModalTx, setRuleModalTx] = useState<TransactionRow | null>(null);
  const [rulePattern, setRulePattern] = useState("");
  const [ruleMatchField, setRuleMatchField] = useState<"all" | "merchant" | "description">("all");
  const [ruleCategoryId, setRuleCategoryId] = useState("");
  const [ruleCostType, setRuleCostType] = useState<"variable" | "fixed" | "transfer">("variable");
  const [ruleApplyRetroactive, setRuleApplyRetroactive] = useState(true);
  const [isSavingRule, setIsSavingRule] = useState(false);

  function handleOpenRuleModal(tx: TransactionRow) {
    setRuleModalTx(tx);
    setRulePattern(tx.merchant || tx.description || "");
    setRuleMatchField("all");
    setRuleCategoryId(tx.categoryId);
    setRuleCostType(tx.costType || "variable");
    setRuleApplyRetroactive(true);
  }

  async function handleSaveRule(e: React.FormEvent) {
    e.preventDefault();
    if (!rulePattern.trim() || !ruleCategoryId) {
      toast.error("Bitte gib ein Suchmuster und eine Kategorie an.");
      return;
    }

    setIsSavingRule(true);
    try {
      const res = await createCategoryRuleAction({
        pattern: rulePattern.trim(),
        matchField: ruleMatchField,
        categoryId: ruleCategoryId,
        costType: ruleCostType,
        priority: 0,
      });

      if (!res.success) {
        toast.error(res.error || "Regel konnte nicht erstellt werden.");
        setIsSavingRule(false);
        return;
      }

      if (ruleApplyRetroactive) {
        const applyRes = await applyCategoryRulesAction();
        if (applyRes.success) {
          toast.success(
            `Regel aktiv! ${applyRes.matchedCount} bestehende Buchungen wurden direkt aktualisiert.`
          );
        } else {
          toast.success("Regel erfolgreich angelegt.");
        }
      } else {
        toast.success("Regel für künftige Buchungen & Syncs erfolgreich angelegt.");
      }

      setRuleModalTx(null);
    } catch {
      toast.error("Unerwarteter Fehler beim Speichern der Regel.");
    } finally {
      setIsSavingRule(false);
    }
  }

  const catMap = useMemo(
    () => Object.fromEntries(categories.map((c) => [c.id, c])),
    [categories]
  );

  const filteredTransactions = useMemo(() => {
    return transactions.filter((tx) => {
      if (pendingDeleteIds.has(tx.id)) return false;
      if (selectedCategory !== "all" && tx.categoryId !== selectedCategory) {
        return false;
      }
      if (selectedCostType !== "all" && tx.costType !== selectedCostType) {
        return false;
      }
      if (selectedBankAccountId !== "all") {
        if (selectedBankAccountId === "manual") {
          if (tx.bankAccountId) return false;
        } else if (tx.bankAccountId !== selectedBankAccountId) {
          return false;
        }
      }
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const catName = catMap[tx.categoryId]?.name?.toLowerCase() || "";
        const matchDesc = tx.description.toLowerCase().includes(q);
        const matchCat = catName.includes(q);
        const matchBank = tx.bankAccountName?.toLowerCase().includes(q);
        if (!matchDesc && !matchCat && !matchBank) return false;
      }
      return true;
    });
  }, [
    transactions,
    selectedCategory,
    selectedCostType,
    selectedBankAccountId,
    search,
    catMap,
    pendingDeleteIds,
  ]);

  const displayedTransactions = useMemo(() => {
    return filteredTransactions.slice(0, visibleCount);
  }, [filteredTransactions, visibleCount]);

  // Gruppierung nach Kalendertag für klare visuelle Trennung & Tagessummen
  const groupedTransactions = useMemo(() => {
    const map = new Map<string, { netCents: number; items: TransactionRow[] }>();

    for (const tx of displayedTransactions) {
      let entry = map.get(tx.date);
      if (!entry) {
        entry = { netCents: 0, items: [] };
        map.set(tx.date, entry);
      }
      entry.items.push(tx);
      entry.netCents += tx.type === "income" ? tx.amountCents : -tx.amountCents;
    }

    const groups: Array<{
      date: string;
      netCents: number;
      items: TransactionRow[];
    }> = [];

    for (const [date, val] of map.entries()) {
      groups.push({
        date,
        netCents: val.netCents,
        items: val.items,
      });
    }

    return groups;
  }, [displayedTransactions]);

  const summary = useMemo(() => {
    let variableExpenses = 0;
    let fixedExpenses = 0;
    let income = 0;

    for (const tx of filteredTransactions) {
      if (tx.type === "income") {
        income += tx.amountCents;
      } else if (tx.costType === "fixed") {
        fixedExpenses += tx.amountCents;
      } else {
        variableExpenses += tx.amountCents;
      }
    }

    return {
      variableExpenses,
      fixedExpenses,
      totalExpenses: variableExpenses + fixedExpenses,
      income,
    };
  }, [filteredTransactions]);

  // Einzelnes Löschen mit „Rückgängig“: Die Zeile verschwindet sofort, der
  // eigentliche Löschaufruf läuft erst nach Ablauf der Frist.

  function handleDelete(id: string) {
    setSwipedId(null);
    if (transactions.find((t) => t.id === id)?.isBankSynced) {
      toast.error(BANK_TRANSACTION_DELETE_ERROR);
      return;
    }
    setPendingDeleteIds((prev) => new Set(prev).add(id));
    let settled = false;
    const restore = () =>
      setPendingDeleteIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    const commit = async () => {
      if (settled) return;
      settled = true;
      const res = await deleteTransactionAction(id);
      if (!res.success) {
        restore();
        toast.error(res.error || "Löschen fehlgeschlagen.");
      }
    };
    toast("Buchung gelöscht", {
      duration: 6000,
      action: {
        label: "Rückgängig",
        onClick: () => {
          settled = true;
          restore();
        },
      },
      onAutoClose: commit,
      onDismiss: commit,
    });
  }

  const [importDropdownOpen, setImportDropdownOpen] = useState(false);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setImportDropdownOpen(false);
      }
    }
    if (importDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [importDropdownOpen]);

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const toastId = toast.loading("Datei wird analysiert und importiert...");
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await importStatementFileAction(formData);
      if (res.success) {
        const fileTypeLabel =
          res.format === "pdf" ? "PDF-Kontoauszug" : res.format === "camt" ? "CAMT-Kontoauszug" : "CSV";
        toast.success(
          `${res.importedCount} Buchungen aus ${fileTypeLabel} importiert${res.skippedDuplicates ? ` (${res.skippedDuplicates} Duplikate übersprungen)` : ""}!`,
          { id: toastId }
        );
      } else {
        toast.error(res.error || "Import fehlgeschlagen.", { id: toastId });
      }
    } catch {
      toast.error("Fehler beim Verarbeiten der Datei.", { id: toastId });
    } finally {
      e.target.value = "";
    }
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-12">
      {/* Sub-Navigation: Umsätze & Buchungen vs. Fixkosten & Daueraufträge */}
      <div className="flex items-center gap-1 p-1 bg-zinc-100 dark:bg-zinc-800/80 rounded-lg w-fit">
        <Link
          href="/transactions"
          className="px-3.5 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100"
        >
          <ListOrdered className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
          <span>Umsätze</span>
        </Link>
        <Link
          href="/recurring"
          className="px-3.5 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200 transition"
        >
          <Repeat className="w-3.5 h-3.5" />
          <span>Fixkosten</span>
        </Link>
      </div>

      {/* Kopfzeile + Zusammenfassung */}
      <div className="pb-4 border-b border-zinc-200/80 dark:border-zinc-800 space-y-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h1 className="text-base font-semibold">Umsätze</h1>
            <p className="text-xs text-zinc-500">
              {filteredTransactions.length} Buchungen im gewählten Zeitraum
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* Separater Import-Dropdown: PDF oder CSV */}
            <div className="relative" ref={dropdownRef}>
              <input
                ref={pdfInputRef}
                type="file"
                accept=".pdf,application/pdf"
                onChange={handleFileUpload}
                className="hidden"
              />
              <input
                ref={csvInputRef}
                type="file"
                accept=".csv,text/csv,.xml,application/xml,text/xml"
                onChange={handleFileUpload}
                className="hidden"
              />

              <button
                type="button"
                onClick={() => setImportDropdownOpen((prev) => !prev)}
                className="px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-xs font-semibold flex items-center gap-1.5 transition"
                title="Kontoauszug oder CSV importieren"
              >
                <Upload className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                <span className="hidden sm:inline">Import</span>
                <ChevronDown className="w-3 h-3 text-zinc-400" />
              </button>

              {importDropdownOpen && (
                <div className="absolute right-0 mt-2 w-56 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-xl p-1.5 z-50 text-xs duration-100">
                  <button
                    type="button"
                    onClick={() => {
                      setImportDropdownOpen(false);
                      setStatementImportFormat("pdf");
                      setStatementImportModalOpen(true);
                    }}
                    className="w-full text-left px-3 py-2.5 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-start gap-2.5 transition cursor-pointer"
                  >
                    <FileText className="w-4 h-4 text-rose-500 mt-0.5 shrink-0" />
                    <div>
                      <div className="font-semibold text-zinc-900 dark:text-zinc-100">
                        PDF-Kontoauszug
                      </div>
                      <div className="text-xs text-zinc-500">
                        Advanzia, Bank-Monatsabrechnung
                      </div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setImportDropdownOpen(false);
                      setStatementImportFormat("csv");
                      setStatementImportModalOpen(true);
                    }}
                    className="w-full text-left px-3 py-2.5 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-start gap-2.5 transition cursor-pointer"
                  >
                    <FileSpreadsheet className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />
                    <div>
                      <div className="font-semibold text-zinc-900 dark:text-zinc-100">
                        CSV / CAMT (XML)
                      </div>
                      <div className="text-xs text-zinc-500">
                        Excel, Bank-Export, CAMT.053
                      </div>
                    </div>
                  </button>
                </div>
              )}
            </div>

            <a
              href="/api/csv/export"
              download
              className="px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-xs font-semibold flex items-center gap-1.5"
              title="Als CSV exportieren"
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">CSV Export</span>
            </a>
            <button
              type="button"
              onClick={() =>
                window.dispatchEvent(new CustomEvent("open-quick-add"))
              }
              className="px-3.5 py-2 rounded-xl bg-brand text-white hover:opacity-90 text-xs font-semibold flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" />
              <span>Neu</span>
            </button>
          </div>
        </div>

        <dl className="grid grid-cols-3 gap-4">
          <div>
            <dt className="text-xs text-zinc-500 dark:text-zinc-400">Variabel</dt>
            <dd className="mt-1 text-base font-medium tabular-nums">{formatCents(summary.variableExpenses)}</dd>
          </div>
          <div>
            <dt className="text-xs text-zinc-500 dark:text-zinc-400">Fixkosten</dt>
            <dd className="mt-1 text-base font-medium tabular-nums">{formatCents(summary.fixedExpenses)}</dd>
          </div>
          <div>
            <dt className="text-xs text-zinc-500 dark:text-zinc-400">Ausgaben gesamt</dt>
            <dd className="mt-1 text-base font-medium tabular-nums">{formatCents(summary.totalExpenses)}</dd>
          </div>
        </dl>
      </div>

      {/* Suche & Filter */}
      <div className="space-y-3 pb-4 border-b border-zinc-200/80 dark:border-zinc-800">
        <div className="relative">
          <Search className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Suche nach Beschreibung oder Kategorie..."
            className="w-full pl-10 pr-3.5 py-2 text-sm rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 focus:outline-none focus:ring-2 focus:ring-blue-600"
          />
        </div>

        <div
          className={cn(
            "grid gap-2",
            bankAccounts.length > 0
              ? "grid-cols-2 sm:grid-cols-4"
              : "grid-cols-3"
          )}
        >
          <select
            value={selectedMonth}
            onChange={(e) => changeMonth(e.target.value)}
            disabled={monthChangePending}
            aria-label="Monat"
            aria-busy={monthChangePending}
            className="px-2.5 py-2 text-xs rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 font-medium disabled:opacity-60"
          >
            <option value="all">Alle Monate</option>
            {availableMonths.map((m) => (
              <option key={m} value={m}>
                {m.split("-")[1]}/{m.split("-")[0]}
              </option>
            ))}
          </select>

          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="px-2.5 py-2 text-xs rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 font-medium"
          >
            <option value="all">Alle Kategorien</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          <select
            value={selectedCostType}
            onChange={(e) =>
              setSelectedCostType(
                e.target.value as "all" | "variable" | "fixed"
              )
            }
            className="px-2.5 py-2 text-xs rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 font-medium"
          >
            <option value="all">Fix & Variabel</option>
            <option value="variable">Nur Variabel</option>
            <option value="fixed">Nur Fixkosten</option>
          </select>

          {bankAccounts.length > 0 && (
            <select
              value={selectedBankAccountId}
              onChange={(e) => setSelectedBankAccountId(e.target.value)}
              className="px-2.5 py-2 text-xs rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 font-medium truncate"
            >
              <option value="all">Alle Konten & Karten</option>
              {bankAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.accountName}
                </option>
              ))}
              <option value="manual">Nur Manuell erfasst</option>
            </select>
          )}
          {hasActiveFilters && (
            <button
              type="button"
              onClick={resetFilters}
              className="px-2.5 py-2 text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:underline"
            >
              Filter zurücksetzen
            </button>
          )}
        </div>
      </div>

      {/* Massen-Aktionsleiste oben: Alle auswählen & Direkte Batch-Aktionen */}
      {filteredTransactions.length > 0 && (
        selectedTxIds.size === 0 ? (
          <div className="flex items-center justify-between px-3 py-2 text-xs text-zinc-500 bg-zinc-50/50 dark:bg-zinc-900/40 rounded-xl border border-zinc-200/60 dark:border-zinc-800/60">
            <label className="flex items-center gap-2 cursor-pointer font-medium hover:text-zinc-900 dark:hover:text-zinc-200 transition">
              <input
                type="checkbox"
                checked={false}
                onChange={handleSelectAll}
                className="w-4 h-4 rounded border-zinc-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
              />
              <span>Alle {filteredTransactions.length} Einträge auswählen</span>
            </label>
          </div>
        ) : (
          <div className="p-2.5 sm:p-3 text-xs bg-blue-50/90 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800/70 rounded-lg flex flex-col md:flex-row md:items-center justify-between gap-2.5 transition">
            <div className="flex items-center gap-2.5">
              <input
                type="checkbox"
                checked={
                  filteredTransactions.length > 0 &&
                  selectedTxIds.size === filteredTransactions.length
                }
                onChange={handleSelectAll}
                className="w-4 h-4 rounded border-blue-400 text-blue-600 focus:ring-blue-500 cursor-pointer"
                title="Alle auswählen / abwählen"
              />
              <span className="font-bold text-blue-900 dark:text-blue-200 flex items-center gap-1.5">
                <span className="bg-brand text-white px-2 py-0.5 rounded-full text-xs font-semibold">
                  {selectedTxIds.size}
                </span>
                ausgewählt
              </span>
              <button
                type="button"
                onClick={() => setSelectedTxIds(new Set())}
                disabled={isBatchUpdating}
                className="text-xs font-medium text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200 underline cursor-pointer ml-1"
              >
                Abwählen
              </button>
            </div>

            <div className="flex items-center gap-1.5 flex-wrap sm:flex-nowrap">
              {/* Kategorie zuweisen */}
              <select
                disabled={isBatchUpdating}
                onChange={(e) => {
                  if (e.target.value) {
                    handleBatchAssignCategory(e.target.value);
                    e.target.value = "";
                  }
                }}
                defaultValue=""
                className="text-xs font-semibold px-2.5 py-1.5 rounded-xl bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 text-zinc-800 dark:text-zinc-200 outline-none cursor-pointer focus:ring-2 focus:ring-blue-500 shrink-0"
              >
                <option value="" disabled>
                  📁 Kategorie zuweisen...
                </option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>

              {/* Typ umschalten */}
              <div className="inline-flex rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 p-0.5 shrink-0">
                <button
                  type="button"
                  onClick={() => handleBatchSetCostType("variable")}
                  disabled={isBatchUpdating}
                  className="px-2 py-1 text-xs font-semibold rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 transition cursor-pointer"
                  title="Als Variable Ausgabe einstufen"
                >
                  Variabel
                </button>
                <button
                  type="button"
                  onClick={() => handleBatchSetCostType("fixed")}
                  disabled={isBatchUpdating}
                  className="px-2 py-1 text-xs font-semibold rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 transition cursor-pointer"
                  title="Als Fixkosten einstufen"
                >
                  Fix
                </button>
                <button
                  type="button"
                  onClick={() => handleBatchSetCostType("transfer")}
                  disabled={isBatchUpdating}
                  className="px-2 py-1 text-xs font-semibold rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 transition cursor-pointer"
                  title="Als Umbuchung einstufen"
                >
                  Umbuchung
                </button>
              </div>

              {/* Löschen */}
              <button
                type="button"
                onClick={handleBatchDelete}
                disabled={isBatchUpdating}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold transition cursor-pointer shrink-0 disabled:opacity-50"
                title="Alle ausgewählten Buchungen löschen"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Löschen</span>
              </button>
            </div>
          </div>
        )
      )}

      {/* Eintragsliste mit Wischgeste (Swipe-to-Action) & Aktionsbuttons */}
      <div className="overflow-hidden">
        {filteredTransactions.length === 0 ? (
          <div className="p-8 text-center">
            <Filter className="w-8 h-8 text-zinc-400 mx-auto mb-2" />
            <p className="text-sm font-medium">Keine Einträge gefunden</p>
            <p className="text-xs text-zinc-500 mt-1">
              Tippe unten auf den großen „+“-Button, um eine neue Ausgabe
              einzutragen.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {groupedTransactions.map((group) => (
              <div
                key={group.date}
                className="divide-y divide-zinc-100 dark:divide-zinc-800/60"
              >
                {/* Tages-Header mit Netto-Tagesbilanz */}
                <div className="bg-zinc-50/85 dark:bg-zinc-950/85 px-4 py-1.5 flex items-center justify-between text-xs font-semibold text-zinc-500 border-b border-zinc-100 dark:border-zinc-800/80">
                  <span className="flex items-center gap-1.5">
                    <Calendar className="w-3 h-3 text-zinc-400" />
                    {formatDateGroupHeader(group.date)}
                  </span>
                  <span
                    className={cn(
                      "font-bold",
                      group.netCents >= 0
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-zinc-600 dark:text-zinc-400"
                    )}
                  >
                    {group.netCents >= 0 ? "+" : ""}
                    {formatCents(group.netCents)}
                  </span>
                </div>

                {group.items.map((tx) => {
                  const cat = catMap[tx.categoryId];
                  const isSwiped = swipedId === tx.id;

                  return (
                    <div
                      key={tx.id}
                      onTouchStart={(e) => {
                        touchStartX.current = e.touches[0]?.clientX ?? null;
                      }}
                      onTouchEnd={(e) => {
                        if (touchStartX.current === null) return;
                        const endX = e.changedTouches[0]?.clientX ?? 0;
                        const diff = touchStartX.current - endX;
                        if (diff > 45) {
                          setSwipedId(tx.id);
                        } else if (diff < -30) {
                          setSwipedId(null);
                        }
                        touchStartX.current = null;
                      }}
                      className="p-3.5 flex items-center justify-between gap-3 hover:bg-zinc-50/70 dark:hover:bg-zinc-800/40 transition"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <input
                          type="checkbox"
                          checked={selectedTxIds.has(tx.id)}
                          onChange={() => toggleSelectTx(tx.id)}
                          className="w-4 h-4 rounded border-zinc-300 text-blue-600 focus:ring-blue-500 cursor-pointer shrink-0"
                          title="Auswählen für Massen-Aktionen"
                        />
                        <div className="w-9 h-9 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-zinc-500 dark:text-zinc-400 shrink-0">
                          <CategoryIcon
                            name={cat?.icon || "ShoppingCart"}
                            className="w-4 h-4"
                          />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <p className="text-sm text-zinc-900 dark:text-zinc-100 truncate">
                              {tx.description}
                            </p>
                            {tx.costType === "transfer" && (
                              <span className="text-xs px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 shrink-0">
                                Umbuchung
                              </span>
                            )}

                            {tx.receiptPath && (
                              <a
                                href={`/api/receipts/${tx.receiptPath}`}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-0.5 text-xs px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 font-medium shrink-0"
                                title="Belegfoto öffnen"
                              >
                                <ImageIcon className="w-3 h-3" />
                                <span>Beleg</span>
                              </a>
                            )}

                            {tx.isSplit && (
                              <button
                                type="button"
                                onClick={() => setSplitTxModal(tx)}
                                className="inline-flex items-center gap-1 text-xs font-semibold px-1.5 py-0.5 rounded-md bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 hover:bg-purple-500/20 transition-colors shrink-0"
                                title="Split-Buchung bearbeiten"
                              >
                                <GitFork className="w-3 h-3" />
                                <span>Split</span>
                              </button>
                            )}
                          </div>
                          <p className="text-xs text-zinc-500 truncate mt-0.5">
                            {formatDateDE(tx.date)} · {cat?.name || "Ohne Kategorie"}
                            {tx.costType === "fixed" ? " · Fixkosten" : ""}
                            {tx.bankAccountName ? ` · ${tx.bankAccountName}` : ""}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <span
                          className={cn(
                            "font-medium text-sm tabular-nums",
                            tx.type === "income"
                              ? "text-emerald-600 dark:text-emerald-400"
                              : "text-zinc-900 dark:text-zinc-100"
                          )}
                        >
                          {tx.type === "income" ? "+" : "−"}
                          {formatCents(tx.amountCents)}
                        </span>

                        <div
                          className={cn(
                            "flex items-center gap-1",
                            isSwiped ? "flex" : "hidden sm:flex"
                          )}
                        >
                          <button
                            type="button"
                            onClick={() => handleOpenRuleModal(tx)}
                            className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 dark:hover:text-zinc-100 dark:hover:bg-zinc-800"
                            title="Regel für diesen Händler erstellen"
                            aria-label={`Regel für ${tx.description} erstellen`}
                          >
                            <ListFilter className="w-4 h-4" aria-hidden="true" />
                          </button>
                          {tx.costType !== "fixed" && (
                            <button
                              type="button"
                              onClick={() =>
                                setRecurringPrefill({
                                  transactionId: tx.id,
                                  name: tx.merchant || tx.description,
                                  amountCents: tx.amountCents,
                                  type: tx.type,
                                  categoryId: tx.categoryId,
                                  date: tx.date,
                                })
                              }
                              className="p-1.5 rounded-lg text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-200 hover:bg-indigo-50 dark:hover:bg-indigo-950/50"
                              title="Als Fixkosten / Dauerauftrag anlegen"
                            >
                              <Repeat className="w-4 h-4" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setSplitTxModal(tx)}
                            className={cn(
                              "p-1.5 rounded-lg transition-colors",
                              tx.isSplit
                                ? "text-zinc-900 dark:text-zinc-100 bg-purple-50 dark:bg-purple-950/40"
                                : "text-zinc-500 hover:text-purple-600 dark:hover:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-950/40"
                            )}
                            title={
                              tx.isSplit
                                ? "Split-Buchung bearbeiten"
                                : "Buchung aufteilen (Split)"
                            }
                          >
                            <GitFork className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setEditingTx({
                                id: tx.id,
                                categoryId: tx.categoryId,
                                type: tx.type,
                                costType: tx.costType,
                                amountCents: tx.amountCents,
                                date: tx.date,
                                description: tx.description,
                                merchant: tx.merchant,
                                paymentMethod: tx.paymentMethod,
                                receiptPath: tx.receiptPath,
                              })
                            }
                            className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800"
                            title="Bearbeiten"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(tx.id)}
                            className="p-1.5 rounded-lg text-red-600 hover:bg-red-500/10"
                            title="Löschen"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>

                        {/* Auf Mobile kleiner Edit/Swipe-Trigger falls nicht gewischt */}
                        {!isSwiped && (
                          <button
                            type="button"
                            onClick={() => setSwipedId(tx.id)}
                            className="sm:hidden p-1.5 text-zinc-400"
                            aria-label="Aktionen anzeigen"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}

            {visibleCount < filteredTransactions.length && (
              <div className="pt-4 pb-2 flex flex-col items-center gap-2">
                <p className="text-xs text-zinc-500">
                  Zeige {visibleCount} von {filteredTransactions.length} Buchungen
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setVisibleCount((prev) => prev + CHUNK_SIZE)}
                    className="px-4 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-xs font-semibold hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-800 dark:text-zinc-200 flex items-center gap-1.5 transition"
                  >
                    <ChevronDown className="w-4 h-4" />
                    <span>
                      Mehr Buchungen laden (+
                      {Math.min(
                        CHUNK_SIZE,
                        filteredTransactions.length - visibleCount
                      )}
                      )
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setVisibleCount(filteredTransactions.length)}
                    className="px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-xs font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400 transition"
                  >
                    Alle ({filteredTransactions.length}) anzeigen
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bearbeiten-Modal */}
      <QuickAddModal
        open={Boolean(editingTx)}
        onClose={() => setEditingTx(null)}
        categories={categories.filter((c) => !c.isArchived)}
        presets={presets}
        bankAccounts={bankAccounts}
        editTransaction={editingTx}
      />

      {/* Fixkosten-Modal */}
      <CreateRecurringModal
        open={Boolean(recurringPrefill)}
        onClose={() => setRecurringPrefill(null)}
        categories={categories.filter((c) => !c.isArchived)}
        prefill={recurringPrefill}
      />

      {/* Kontoauszug & CSV Import-Modal mit Zielkonto-Auswahl */}
      <StatementImportModal
        open={statementImportModalOpen}
        onClose={() => setStatementImportModalOpen(false)}
        accounts={bankAccounts}
        defaultFormat={statementImportFormat}
      />

      {/* Auto-Kategorisierungsregel Modal */}
      {ruleModalTx && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 duration-150">
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl w-full max-w-md shadow-lg overflow-hidden flex flex-col">
            <div className="p-5 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 flex items-center justify-center">
                  <ListFilter className="w-5 h-5" aria-hidden="true" />
                </div>
                <div>
                  <h3 className="font-semibold text-sm text-zinc-900 dark:text-zinc-100">
                    Regel erstellen
                  </h3>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    Zukünftige & bestehende Umsätze automatisch zuordnen
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setRuleModalTx(null)}
                className="p-1.5 rounded-xl text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveRule} className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                  Suchbegriff / Muster *
                </label>
                <input
                  type="text"
                  required
                  value={rulePattern}
                  onChange={(e) => setRulePattern(e.target.value)}
                  placeholder="z. B. Spotify, Rewe, PayPal, Shell"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-xs font-semibold focus:ring-2 focus:ring-amber-500 outline-hidden transition"
                />
                <span className="text-xs text-zinc-400 mt-1 block">
                  Wird bei PSD2-Sync, CSV- und PDF-Importen automatisch abgeglichen.
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                    Suchfeld
                  </label>
                  <select
                    value={ruleMatchField}
                    onChange={(e) =>
                      setRuleMatchField(e.target.value as "all" | "merchant" | "description")
                    }
                    className="w-full px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-xs font-medium focus:ring-2 focus:ring-amber-500 outline-hidden transition"
                  >
                    <option value="all">Überall suchen</option>
                    <option value="merchant">Nur Händler</option>
                    <option value="description">Nur Verwendungszweck</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                    Kostenart
                  </label>
                  <select
                    value={ruleCostType}
                    onChange={(e) =>
                      setRuleCostType(e.target.value as "variable" | "fixed" | "transfer")
                    }
                    className="w-full px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-xs font-medium focus:ring-2 focus:ring-amber-500 outline-hidden transition"
                  >
                    <option value="variable">Variabel</option>
                    <option value="fixed">Fixkosten</option>
                    <option value="transfer">Umbuchung</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                  Ziel-Kategorie *
                </label>
                <select
                  required
                  value={ruleCategoryId}
                  onChange={(e) => setRuleCategoryId(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-xs font-medium focus:ring-2 focus:ring-amber-500 outline-hidden transition"
                >
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.type === "income" ? "Einnahme" : "Ausgabe"})
                    </option>
                  ))}
                </select>
              </div>

              <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800">
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={ruleApplyRetroactive}
                    onChange={(e) => setRuleApplyRetroactive(e.target.checked)}
                    className="mt-0.5 rounded border-zinc-300 text-amber-600 focus:ring-amber-500"
                  />
                  <div>
                    <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-200 block">
                      Sofort auf alle bestehenden Buchungen anwenden
                    </span>
                    <span className="text-xs text-zinc-400">
                      Aktualisiert vergangene Umsätze, die zu diesem Suchmuster passen.
                    </span>
                  </div>
                </label>
              </div>

              <div className="pt-3 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setRuleModalTx(null)}
                  disabled={isSavingRule}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition cursor-pointer"
                >
                  Abbrechen
                </button>
                <button
                  type="submit"
                  disabled={isSavingRule}
                  className="px-4 py-2 rounded-xl border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-900 dark:text-zinc-100 text-xs font-bold transition cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                >
                  {isSavingRule && <span className="animate-spin">⏳</span>}
                  <span>Regel speichern</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* App-eigener Bestätigungsdialog für Löschen */}
      <ConfirmModal
        open={Boolean(deleteConfirm)}
        title={
          deleteConfirm?.type === "batch"
            ? `${selectedTxIds.size} Buchungen löschen`
            : "Eintrag löschen"
        }
        message={
          deleteConfirm?.type === "batch"
            ? `Möchtest du die ${selectedTxIds.size} ausgewählten Buchungen wirklich unwiderruflich löschen? Verknüpfte Kontosalden werden automatisch zurückgerechnet.`
            : "Möchtest du diesen Eintrag wirklich unwiderruflich löschen? Verknüpfte Kontosalden werden automatisch zurückgerechnet."
        }
        confirmText="Unwiderruflich löschen"
        cancelText="Abbrechen"
        variant="danger"
        loading={isDeletingTx}
        onCancel={() => setDeleteConfirm(null)}
        onConfirm={async () => {
          if (!deleteConfirm) return;
          setIsDeletingTx(true);
          try {
            if (deleteConfirm.type === "single" && deleteConfirm.id) {
              const res = await deleteTransactionAction(deleteConfirm.id);
              if (res.success) {
                toast.success("Eintrag gelöscht.");
                setSwipedId(null);
                setDeleteConfirm(null);
              } else {
                toast.error(res.error || "Löschen fehlgeschlagen.");
              }
            } else if (deleteConfirm.type === "batch") {
              const res = await batchDeleteTransactionsAction(Array.from(selectedTxIds));
              if (res.success) {
                toast.success(`${res.count} Buchungen erfolgreich gelöscht.`);
                if (res.skippedBankCount) {
                  toast.info(
                    `${res.skippedBankCount} von der Bank übernommene Buchungen wurden nicht gelöscht.`
                  );
                }
                setSelectedTxIds(new Set());
                setDeleteConfirm(null);
              } else {
                toast.error(res.error || "Löschen fehlgeschlagen.");
              }
            }
          } catch {
            toast.error("Fehler beim Löschen.");
          } finally {
            setIsDeletingTx(false);
          }
        }}
      />

      {/* Split-Buchungs-Modal */}
      {splitTxModal && (
        <SplitTransactionModal
          open={Boolean(splitTxModal)}
          onClose={() => setSplitTxModal(null)}
          transaction={splitTxModal}
          categories={categories}
        />
      )}
    </div>
  );
}
