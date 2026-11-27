"use client";

import { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import {
  disconnectBankAction,
  deleteBankAccountAction,
  toggleAccountAutoSyncAction,
  syncBankAccountAction,
  syncAllAccountsAction,
} from "@/actions/bank-actions";
import {
  POPULAR_BANK_INSTITUTIONS,
  type BankInstitution,
} from "@/lib/bank-institutions";
import { formatDateDE, formatCents } from "@/lib/format";
import {
  Landmark,
  Plus,
  CreditCard,
  PiggyBank,
  ShieldCheck,
  Search,
  CheckCircle2,
  AlertCircle,
  X,
  Trash2,
  RefreshCw,
  Lock,
  ArrowRight,
  Loader2,
  HelpCircle,
  ExternalLink,
  Calendar,
  Check,
  ChevronRight,
  ChevronDown,
  History,
  Repeat,
  Wallet,
  Coins,
  Key,
  Pencil,
  ArrowRightLeft,
  Info,
  Scale,
} from "lucide-react";
import { toast } from "sonner";
import { bankErrorMessage } from "@/lib/bank-error-codes";
import { cn } from "@/lib/utils";
import {
  CreateRecurringModal,
  type CreateRecurringCategoryOption,
  type PrefillRecurringData,
} from "@/components/recurring/create-recurring-modal";
import { ManualAccountModal } from "./manual-account-modal";
import { AccountTransferModal } from "./account-transfer-modal";
import { BalanceReconciliationModal } from "./balance-reconciliation-modal";
import { ConfirmModal } from "@/components/ui/confirm-modal";

export interface RecentBankTransactionItem {
  id: string;
  categoryId?: string;
  amountCents: number;
  type: "expense" | "income";
  date: string;
  description: string;
  merchant: string | null;
  categoryName?: string | null;
}

export interface ConnectedAccountItem {
  id: string;
  accountName: string;
  accountType: "checking" | "credit_card" | "savings" | "cash" | "paypal";
  ibanMasked: string | null;
  currency: string;
  balanceCents: number | null;
  creditLimitCents?: number | null;
  billingDayOfMonth?: number | null;
  notes?: string | null;
  autoSync: boolean;
  /** Letzter Fehler beim automatischen Abruf (null = ok) */
  lastSyncError?: string | null;
  /** Automatischer Abruf pausiert bis (ISO-Zeitpunkt) */
  syncBackoffUntil?: string | null;
  recentTransactions?: RecentBankTransactionItem[];
}

export interface ConnectedBankItem {
  id: string;
  institutionId: string;
  institutionName: string;
  institutionLogo: string | null;
  consentExpiresAt: string;
  status: string;
  lastSyncedAt: string | null;
  isManual?: boolean;
  accounts: ConnectedAccountItem[];
}

export function BankingHubView({
  connectedBanks = [],
  categories = [],
  isLiveMode = false,
  isDemoAvailable = true,
  isAdmin = false,
}: {
  connectedBanks: ConnectedBankItem[];
  categories?: CreateRecurringCategoryOption[];
  isLiveMode?: boolean;
  isDemoAvailable?: boolean;
  isAdmin?: boolean;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const [liveInfoOpen, setLiveInfoOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<
    "all" | "giro" | "credit_card"
  >("all");
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);
  const [deletingAccountId, setDeletingAccountId] = useState<string | null>(null);
  const [syncingAccountId, setSyncingAccountId] = useState<string | null>(null);
  const [syncingAll, setSyncingAll] = useState(false);
  const [expandedAccountIds, setExpandedAccountIds] = useState<Record<string, boolean>>({});
  const [recurringModalPrefill, setRecurringModalPrefill] = useState<PrefillRecurringData | null>(null);
  const [manualAccountModalOpen, setManualAccountModalOpen] = useState(false);
  const [accountToEdit, setAccountToEdit] = useState<ConnectedAccountItem | null>(null);
  const [transferModalOpen, setTransferModalOpen] = useState(false);
  const [transferDefaultTargetId, setTransferDefaultTargetId] = useState<string | null>(null);
  const [reconciliationModalOpen, setReconciliationModalOpen] = useState(false);
  const [reconciliationAccount, setReconciliationAccount] = useState<ConnectedAccountItem | null>(null);

  function toggleAccountHistory(accountId: string) {
    setExpandedAccountIds((prev) => ({
      ...prev,
      [accountId]: !prev[accountId],
    }));
  }

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("bank_connected") === "1") {
      toast.success("Bank verbunden.");
      window.history.replaceState({}, "", window.location.pathname);
    } else if (params.get("bank_error")) {
      // Nur feste Codes aus der URL übersetzen, nie Freitext anzeigen
      const code = params.get("bank_error") ?? "";
      if (code === "redirect_uri_not_allowed") {
        toast.error(bankErrorMessage(code), { duration: 8000 });
        setLiveInfoOpen(true);
      } else {
        toast.error(bankErrorMessage(code), { duration: 6000 });
      }
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  // Filterung der unterstützten Banken
  const filteredInstitutions = useMemo(() => {
    return POPULAR_BANK_INSTITUTIONS.filter((inst) => {
      const matchesSearch =
        inst.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        inst.description.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesCategory =
        categoryFilter === "all" ||
        inst.category === categoryFilter ||
        inst.category === "both";
      return matchesSearch && matchesCategory;
    });
  }, [searchQuery, categoryFilter]);

  // Berechnung aggregierter Salden & Kontotypen
  const allAccounts = useMemo(
    () => connectedBanks.flatMap((b) => b.accounts),
    [connectedBanks]
  );

  const totalBalanceCents = useMemo(
    () =>
      allAccounts.reduce(
        (sum, a) => sum + (a.balanceCents !== null ? a.balanceCents : 0),
        0
      ),
    [allAccounts]
  );

  const checkingAccounts = useMemo(
    () => allAccounts.filter((a) => a.accountType === "checking"),
    [allAccounts]
  );
  const checkingBalanceCents = useMemo(
    () =>
      checkingAccounts.reduce((sum, a) => sum + (a.balanceCents || 0), 0),
    [checkingAccounts]
  );

  const cardAccounts = useMemo(
    () => allAccounts.filter((a) => a.accountType === "credit_card"),
    [allAccounts]
  );
  const cardBalanceCents = useMemo(
    () => cardAccounts.reduce((sum, a) => sum + (a.balanceCents || 0), 0),
    [cardAccounts]
  );

  const savingsAccounts = useMemo(
    () => allAccounts.filter((a) => a.accountType === "savings"),
    [allAccounts]
  );
  const savingsBalanceCents = useMemo(
    () =>
      savingsAccounts.reduce((sum, a) => sum + (a.balanceCents || 0), 0),
    [savingsAccounts]
  );

  function handleConnect(institution: BankInstitution | string) {
    const instId = typeof institution === "string" ? institution : institution.id;
    setConnectingId(instId);
    window.location.href = `/api/bank-sync/authorize?institutionId=${encodeURIComponent(
      instId
    )}`;
  }

  const [bankingConfirm, setBankingConfirm] = useState<{
    title: string;
    message: string;
    onConfirm: () => Promise<void>;
  } | null>(null);
  const [bankingConfirmLoading, setBankingConfirmLoading] = useState(false);

  function handleDisconnect(bank: ConnectedBankItem) {
    setBankingConfirm({
      title: "Bankverbindung trennen",
      message: `Möchtest du die Bankverbindung zu „${bank.institutionName}“ und alle zugehörigen Konten wirklich trennen?`,
      onConfirm: async () => {
        setDisconnectingId(bank.id);
        try {
          const res = await disconnectBankAction(bank.id);
          if (res.success) {
            toast.success(`Verbindung zu „${bank.institutionName}“ getrennt.`);
            setBankingConfirm(null);
          } else {
            toast.error(res.error || "Fehler beim Trennen.");
          }
        } catch {
          toast.error("Fehler beim Trennen der Verbindung.");
        } finally {
          setDisconnectingId(null);
        }
      },
    });
  }

  function handleDeleteAccount(account: ConnectedAccountItem) {
    const isCard = account.accountType === "credit_card";
    const label = isCard ? "die Kreditkarte" : "das Konto";
    setBankingConfirm({
      title: `${isCard ? "Kreditkarte" : "Konto"} löschen`,
      message: `Möchtest du ${label} „${account.accountName}“ wirklich löschen? Vorhandene Umsätze bleiben als manuelle Buchungen erhalten.`,
      onConfirm: async () => {
        setDeletingAccountId(account.id);
        try {
          const res = await deleteBankAccountAction(account.id);
          if (res.success) {
            toast.success(`${isCard ? "Kreditkarte" : "Konto"} erfolgreich gelöscht.`);
            setBankingConfirm(null);
          } else {
            toast.error(res.error || "Löschen fehlgeschlagen.");
          }
        } catch {
          toast.error("Fehler beim Löschen.");
        } finally {
          setDeletingAccountId(null);
        }
      },
    });
  }

  async function handleToggleAutoSync(
    account: ConnectedAccountItem,
    nextVal: boolean
  ) {
    const res = await toggleAccountAutoSyncAction(account.id, nextVal);
    if (res.success) {
      toast.success(
        nextVal
          ? `Auto-Sync für „${account.accountName}“ aktiviert.`
          : `Auto-Sync für „${account.accountName}“ pausiert.`
      );
    } else {
      toast.error(res.error || "Status konnte nicht geändert werden.");
    }
  }

  async function handleSyncAccount(accountId: string) {
    setSyncingAccountId(accountId);
    try {
      const res = await syncBankAccountAction(accountId);
      if (res.success) {
        toast.success(
          `Sync erfolgreich: ${res.importedCount} neue Umsätze importiert (${res.skippedCount} Duplikate übersprungen).`
        );
      } else {
        toast.error(res.error || "Synchronisation fehlgeschlagen.");
      }
    } catch {
      toast.error("Fehler beim Synchronisieren der Bankumsätze.");
    } finally {
      setSyncingAccountId(null);
    }
  }

  async function handleSyncAll() {
    setSyncingAll(true);
    try {
      const res = await syncAllAccountsAction();
      if (res.success) {
        toast.success(
          `Alle aktiven Konten synchronisiert: ${res.totalImported} neue Umsätze (${res.totalSkipped} übersprungen).`
        );
      } else {
        const errMsg =
          res.errors && res.errors.length > 0
            ? res.errors.join(", ")
            : "Synchronisation fehlgeschlagen.";
        toast.error(`Sync fehlgeschlagen: ${errMsg}`);
      }
    } catch {
      toast.error("Fehler bei der Gesamtsynchronisation.");
    } finally {
      setSyncingAll(false);
    }
  }

  function getConsentDaysRemaining(expiresAtStr: string): number {
    try {
      const exp = new Date(expiresAtStr).getTime();
      const now = new Date().getTime();
      return Math.ceil((exp - now) / (1000 * 60 * 60 * 24));
    } catch {
      return 0;
    }
  }

  return (
    <div className="space-y-8 max-w-5xl mx-auto pb-12">
      {/* 1. Kopf */}
      <div className="space-y-2">
        <h1 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Konten</h1>
        {!isLiveMode && (
          <p className="text-sm text-zinc-500 dark:text-zinc-400 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="w-2 h-2 rounded-full bg-amber-500" aria-hidden="true" />
            {isDemoAvailable
              ? "Demo-Modus: Banken werden mit simulierten Konten und Buchungen verbunden."
              : "Automatischer Bankabruf ist nicht eingerichtet. Manuelle Konten funktionieren."}
            {isAdmin ? (
              <button
                type="button"
                onClick={() => setLiveInfoOpen(true)}
                className="text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
              >
                Einrichten
              </button>
            ) : (
              !isDemoAvailable && <span>Wende dich an den Administrator.</span>
            )}
          </p>
        )}
      </div>

      {/* 2. Salden */}
      <dl className="grid grid-cols-3 gap-4 py-4 border-y border-zinc-200 dark:border-zinc-800">
        <div>
          <dt className="text-xs text-zinc-500 dark:text-zinc-400">
            Gesamt · {allAccounts.length} {allAccounts.length === 1 ? "Konto" : "Konten"}
          </dt>
          <dd className={cn("mt-1 text-base font-medium tabular-nums", totalBalanceCents < 0 && "text-red-600 dark:text-red-400")}>
            {formatCents(totalBalanceCents)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-500 dark:text-zinc-400">Girokonten · {checkingAccounts.length}</dt>
          <dd className={cn("mt-1 text-base font-medium tabular-nums", checkingBalanceCents < 0 && "text-red-600 dark:text-red-400")}>
            {formatCents(checkingBalanceCents)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-500 dark:text-zinc-400">Karten · {cardAccounts.length}</dt>
          <dd className={cn("mt-1 text-base font-medium tabular-nums", cardBalanceCents < 0 && "text-red-600 dark:text-red-400")}>
            {formatCents(cardBalanceCents)}
          </dd>
        </div>
      </dl>

      {/* 3. Aktionen: Bank hinzufügen, Manuelles Konto, Umbuchung & Alle synchronisieren */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="inline-flex items-center justify-center gap-2 px-3.5 py-2 rounded-xl bg-brand text-white hover:opacity-90 font-bold text-xs transition cursor-pointer"
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
            <span>Bank verbinden</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setAccountToEdit(null);
              setManualAccountModalOpen(true);
            }}
            className="inline-flex items-center justify-center gap-2 px-3.5 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-800 dark:text-zinc-200 font-bold text-xs transition cursor-pointer"
          >
            <span>Konto manuell anlegen</span>
          </button>

          {allAccounts.length >= 2 && (
            <button
              type="button"
              onClick={() => {
                setTransferDefaultTargetId(null);
                setTransferModalOpen(true);
              }}
              className="inline-flex items-center justify-center gap-2 px-3.5 py-2 rounded-xl bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 font-semibold text-xs transition cursor-pointer"
            >
              <span>Umbuchung</span>
            </button>
          )}
        </div>

        {connectedBanks.some((b) => !b.isManual) && (
          <button
            type="button"
            onClick={handleSyncAll}
            disabled={syncingAll}
            className="inline-flex items-center justify-center gap-2 px-3.5 py-2 rounded-xl bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200 font-semibold text-xs transition disabled:opacity-50 cursor-pointer self-start md:self-auto"
          >
            <RefreshCw
              className={cn("w-3.5 h-3.5", syncingAll && "animate-spin")}
            />
            <span>
              {syncingAll ? "Synchronisiere..." : "Alle aktualisieren"}
            </span>
          </button>
        )}
      </div>

      {connectedBanks.some((b) => !b.isManual) && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Banken liefern beim Abruf meist nur die letzten 90 Tage. Ältere Umsätze lassen sich per
          Kontoauszug (CSV, CAMT oder PDF) importieren.
        </p>
      )}

      {/* 4. Liste der verbundenen Banken & Konten */}
      {connectedBanks.length === 0 ? (
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-8 text-center space-y-4">
          <div className="max-w-md mx-auto space-y-1">
            <h3 className="font-bold text-base text-zinc-900 dark:text-zinc-100">
              Noch keine Konten
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Verbinde ein Girokonto oder lege Karten und Bargeld manuell an.
            </p>
          </div>

          <div className="pt-2 flex flex-wrap items-center justify-center gap-2.5">
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-brand text-white hover:opacity-90 font-bold text-xs transition cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Bank verbinden</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setAccountToEdit(null);
                setManualAccountModalOpen(true);
              }}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-900 dark:text-zinc-100 font-bold text-xs transition cursor-pointer"
            >
              <CreditCard className="w-4 h-4" />
              <span>Manuelle Karte anlegen (z. B. Advanzia)</span>
            </button>
          </div>

          {/* Unterstützte Banken Vorschau */}
          <div className="pt-4 border-t border-zinc-100 dark:border-zinc-800 max-w-sm mx-auto">
            <p className="text-xs font-semibold text-zinc-400 mb-2">
              Unterstützte Institute & Karten
            </p>
            <div className="flex flex-wrap justify-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400">
              <span className="px-2 py-0.5 rounded-md bg-zinc-100 dark:bg-zinc-800">
                ING
              </span>
              <span className="px-2 py-0.5 rounded-md bg-zinc-100 dark:bg-zinc-800">
                C24 Bank
              </span>
              <span className="px-2 py-0.5 rounded-md bg-zinc-100 dark:bg-zinc-800">
                Sparkasse
              </span>
              <span className="px-2 py-0.5 rounded-md bg-zinc-100 dark:bg-zinc-800">
                Commerzbank
              </span>
              <span className="px-2 py-0.5 rounded-md bg-zinc-100 dark:bg-zinc-800">
                TF Bank Mastercard
              </span>
              <span className="px-2 py-0.5 rounded-md bg-zinc-100 dark:bg-zinc-800">
                Advanzia gebührenfrei
              </span>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {connectedBanks.map((bank) => {
            const daysLeft = getConsentDaysRemaining(bank.consentExpiresAt);
            const isExpiringSoon = daysLeft <= 14;
            const isExpired =
              daysLeft <= 0 ||
              bank.status === "expired" ||
              bank.status === "revoked";
            // Scheitert der Abruf (z. B. Tokens nach Schlüsselwechsel nicht lesbar),
            // hilft eine neue Freigabe bei der Bank; Konten und Buchungen bleiben.
            const hasSyncError =
              bank.status === "error" || bank.accounts.some((a) => Boolean(a.lastSyncError));
            const statusBadge = bank.isManual
              ? { label: "Manuell", className: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400" }
              : isExpired
                ? { label: "Neu verbinden nötig", className: "bg-red-500/10 text-red-600 dark:text-red-400" }
                : bank.status === "error"
                  ? { label: "Fehler", className: "bg-amber-500/10 text-amber-700 dark:text-amber-400" }
                  : { label: "Verbunden", className: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400" };

            return (
              <div
                key={bank.id}
                className="space-y-1 pb-6 border-b border-zinc-200/80 dark:border-zinc-800 last:border-b-0"
              >
                {/* Bank Header */}
                <div className="py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold text-xs shrink-0"
                      style={{
                        backgroundColor: bank.institutionLogo || "#2563eb",
                      }}
                    >
                      {bank.institutionName.slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-bold text-sm text-zinc-900 dark:text-zinc-100">
                          {bank.institutionName}
                        </h3>
                        <span
                          className={cn(
                            "text-xs font-semibold px-2 py-0.5 rounded-md",
                            statusBadge.className
                          )}
                        >
                          {statusBadge.label}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 text-xs text-zinc-500 dark:text-zinc-400 flex-wrap">
                        {bank.isManual ? (
                          <span className="inline-flex items-center gap-1 font-medium text-emerald-600 dark:text-emerald-400">
                            <Check className="w-3 h-3" />
                            <span>Manuell verwaltet • Lokal & offline</span>
                          </span>
                        ) : (
                          <span
                            className={cn(
                              "inline-flex items-center gap-1 font-medium",
                              isExpired
                                ? "text-red-600 dark:text-red-400"
                                : isExpiringSoon
                                  ? "text-amber-600 dark:text-amber-400"
                                  : "text-zinc-500 dark:text-zinc-400"
                            )}
                            title={`PSD2-Zustimmung gültig bis ${formatDateDE(bank.consentExpiresAt)}`}
                          >
                            <Calendar className="w-3 h-3" />
                            {isExpired
                              ? "Zustimmung abgelaufen"
                              : `Zustimmung: noch ${daysLeft} Tage`}
                          </span>
                        )}

                        {bank.lastSyncedAt && (
                          <>
                            <span>•</span>
                            <span>
                              Sync:{" "}
                              {formatDateDE(bank.lastSyncedAt.slice(0, 10))}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 self-end sm:self-auto">
                    {/* Zustimmung erneuern bei bald ablaufender oder abgelaufener PSD2-Zustimmung
                        oder neu verbinden, wenn der Abruf fehlschlägt */}
                    {!bank.isManual && (isExpired || isExpiringSoon || hasSyncError) && (
                      <button
                        type="button"
                        onClick={() => handleConnect(bank.institutionId)}
                        disabled={connectingId === bank.institutionId}
                        className="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/50 hover:bg-blue-100 dark:hover:bg-blue-900/50 border border-blue-200 dark:border-blue-800 transition flex items-center gap-1.5 cursor-pointer"
                        title="Bei der Bank erneut freigeben. Konten und Buchungen bleiben erhalten."
                      >
                        {connectingId === bank.institutionId ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <RefreshCw className="w-3.5 h-3.5" />
                        )}
                        <span>{isExpired || isExpiringSoon ? "Zustimmung erneuern" : "Neu verbinden"}</span>
                      </button>
                    )}

                    {/* Bank trennen Button (nur für echte PSD2 Banken) */}
                    {!bank.isManual && (
                      <button
                        type="button"
                        onClick={() => handleDisconnect(bank)}
                        disabled={disconnectingId === bank.id}
                        className="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 border border-transparent hover:border-red-200 dark:hover:border-red-900/50 transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                        title="Bankverbindung trennen"
                      >
                        {disconnectingId === bank.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="w-3.5 h-3.5" />
                        )}
                        <span>Trennen</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Unterkonten-Liste */}
                <div className="divide-y divide-zinc-100 dark:divide-zinc-800/80">
                  {bank.accounts.length === 0 ? (
                    <div className="p-4 text-xs text-zinc-400 text-center">
                      Keine aktiven Konten für diese Bank hinterlegt.
                    </div>
                  ) : (
                    bank.accounts.map((account) => {
                      const isSyncing = syncingAccountId === account.id;
                      const Icon =
                        account.accountType === "credit_card"
                          ? CreditCard
                          : account.accountType === "savings"
                            ? PiggyBank
                            : account.accountType === "cash"
                              ? Coins
                              : account.accountType === "paypal"
                                ? Wallet
                                : Landmark;

                      const isCc = account.accountType === "credit_card";
                      // Negativer Saldo = Schulden, positiver Saldo = Guthaben auf der Karte
                      const balCents = account.balanceCents ?? 0;
                      const limitCents = account.creditLimitCents ?? 0;
                      const availCents = isCc && limitCents > 0 ? Math.max(0, limitCents + balCents) : null;

                      return (
                        <div key={account.id} className="transition">
                          <div className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-zinc-50/50 dark:hover:bg-zinc-800/20 transition">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-9 h-9 rounded-xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-zinc-600 dark:text-zinc-300 shrink-0">
                              <Icon className="w-4 h-4" />
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-semibold text-xs text-zinc-900 dark:text-zinc-100 truncate">
                                  {account.accountName}
                                </span>
                                <span className="text-xs px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 font-medium">
                                  {account.accountType === "credit_card"
                                    ? "Kreditkarte"
                                    : account.accountType === "savings"
                                      ? "Tagesgeld"
                                      : account.accountType === "cash"
                                        ? "Bargeld"
                                        : account.accountType === "paypal"
                                          ? "PayPal"
                                          : "Girokonto"}
                                </span>
                              </div>
                              <p className="text-xs text-zinc-400 tabular-nums mt-0.5 truncate">
                                {account.ibanMasked || "Keine IBAN"}
                              </p>

                              {!bank.isManual && account.lastSyncError && (
                                <p
                                  role="status"
                                  className="mt-1 text-xs text-amber-700 dark:text-amber-400 flex items-start gap-1"
                                >
                                  <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" aria-hidden="true" />
                                  <span>
                                    Letzter Abruf fehlgeschlagen
                                    {account.syncBackoffUntil &&
                                    new Date(account.syncBackoffUntil) > new Date()
                                      ? ` – automatischer Abruf pausiert bis ${new Date(
                                          account.syncBackoffUntil
                                        ).toLocaleString("de-DE", {
                                          day: "2-digit",
                                          month: "2-digit",
                                          hour: "2-digit",
                                          minute: "2-digit",
                                        })}`
                                      : ""}
                                    . Manuelles Aktualisieren ist jederzeit möglich.
                                    <span className="block text-zinc-500 dark:text-zinc-400 truncate" title={account.lastSyncError}>
                                      {account.lastSyncError}
                                    </span>
                                  </span>
                                </p>
                              )}

                              {isCc && limitCents > 0 && (
                                <div className="flex items-center gap-1.5 mt-1 text-xs text-zinc-500 dark:text-zinc-400 flex-wrap">
                                  <span className="font-bold text-amber-700 dark:text-amber-400">
                                    Kartenlimit: {formatCents(limitCents)}
                                  </span>
                                  {availCents !== null && (
                                    <>
                                      <span>•</span>
                                      <span className="font-bold text-emerald-600 dark:text-emerald-400">
                                        Verfügbar: {formatCents(availCents)}
                                      </span>
                                    </>
                                  )}
                                  {balCents < 0 && (
                                    <>
                                      <span>•</span>
                                      <span className="font-bold text-red-600 dark:text-red-400">
                                        Schulden: {formatCents(Math.abs(balCents))}
                                      </span>
                                    </>
                                  )}
                                  {account.billingDayOfMonth && (
                                    <>
                                      <span>•</span>
                                      <span>Abrechnung: {account.billingDayOfMonth}. d. M.</span>
                                    </>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center justify-between sm:justify-end gap-2.5 sm:gap-3 shrink-0 flex-wrap">
                            {/* Saldo / Schulden */}
                            <div className="text-right">
                              <div
                                className={cn(
                                  "font-semibold text-sm tabular-nums",
                                  isCc
                                    ? balCents < 0
                                      ? "text-red-600 dark:text-red-400"
                                      : "text-emerald-600 dark:text-emerald-400"
                                    : account.balanceCents !== null && account.balanceCents >= 0
                                      ? "text-emerald-600 dark:text-emerald-400"
                                      : "text-zinc-900 dark:text-zinc-100"
                                )}
                              >
                                {isCc
                                  ? formatCents(balCents)
                                  : account.balanceCents !== null
                                    ? formatCents(account.balanceCents)
                                    : "–"}
                              </div>
                              <span className="text-xs text-zinc-400 font-medium">
                                {isCc
                                  ? balCents < 0
                                    ? "Offene Kartenschulden"
                                    : "Guthaben / Ausgeglichen"
                                  : account.currency || "EUR"}
                              </span>
                            </div>

                            {/* Kartenausgleich Button für Kreditkarten */}
                            {account.accountType === "credit_card" && (
                              <button
                                type="button"
                                onClick={() => {
                                  setTransferDefaultTargetId(account.id);
                                  setTransferModalOpen(true);
                                }}
                                className="px-2 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/40 dark:hover:bg-blue-900/40 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 text-xs font-semibold flex items-center gap-1 transition cursor-pointer"
                                title="Kartenausgleich durchführen"
                              >
                                <ArrowRightLeft className="w-3 h-3" />
                                <span>Ausgleichen</span>
                              </button>
                            )}

                            {/* Kassensturz & Saldenabgleich Button für manuelle Konten/Karten */}
                            {bank.isManual && (
                              <button
                                type="button"
                                onClick={() => {
                                  setReconciliationAccount(account);
                                  setReconciliationModalOpen(true);
                                }}
                                className="px-2 py-1 rounded-lg bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700 text-xs font-semibold flex items-center gap-1 transition cursor-pointer"
                                title="Kassensturz: Saldo auf tatsächlichen Stand abgleichen"
                              >
                                <Scale className="w-3 h-3 text-blue-600 dark:text-blue-400" />
                                <span>Kassensturz</span>
                              </button>
                            )}

                            {/* Auto-Sync Toggle (nur bei PSD2-Banken) */}
                            {!bank.isManual && (
                              <button
                                type="button"
                                onClick={() =>
                                  handleToggleAutoSync(
                                    account,
                                    !account.autoSync
                                  )
                                }
                                className={cn(
                                  "text-xs font-medium px-2 py-1 rounded-lg border transition cursor-pointer flex items-center gap-1",
                                  account.autoSync
                                    ? "bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-900 text-blue-700 dark:text-blue-300"
                                    : "bg-zinc-50 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-500"
                                )}
                                title={
                                  account.autoSync
                                    ? "Auto-Sync aktiv: Umsätze werden automatisch synchronisiert"
                                    : "Auto-Sync pausiert"
                                }
                              >
                                <span
                                  className={cn(
                                    "w-1.5 h-1.5 rounded-full",
                                    account.autoSync
                                      ? "bg-blue-600 dark:bg-blue-400"
                                      : "bg-zinc-400"
                                  )}
                                />
                                <span>
                                  {account.autoSync ? "Auto-Sync" : "Pausiert"}
                                </span>
                              </button>
                            )}

                            {/* Einzelner Sync Button (nur bei PSD2-Banken) */}
                            {!bank.isManual && (
                              <button
                                type="button"
                                onClick={() => handleSyncAccount(account.id)}
                                disabled={isSyncing}
                                className="p-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300 transition cursor-pointer disabled:opacity-50"
                                title="Jetzt Umsätze abrufen"
                              >
                                <RefreshCw
                                  className={cn(
                                    "w-3.5 h-3.5",
                                    isSyncing && "animate-spin text-blue-600"
                                  )}
                                />
                              </button>
                            )}

                            {/* Bearbeiten Button */}
                            <button
                              type="button"
                              onClick={() => {
                                setAccountToEdit(account);
                                setManualAccountModalOpen(true);
                              }}
                              className="p-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300 transition cursor-pointer"
                              title="Konto / Karte bearbeiten"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>

                            {/* Konto / Karte löschen */}
                            <button
                              type="button"
                              onClick={() => handleDeleteAccount(account)}
                              disabled={deletingAccountId === account.id}
                              className="p-1.5 rounded-lg border border-transparent hover:border-red-200 dark:hover:border-red-900/50 hover:bg-red-50 dark:hover:bg-red-950/40 text-red-600 dark:text-red-400 transition cursor-pointer disabled:opacity-50"
                              title={
                                account.accountType === "credit_card"
                                  ? "Kreditkarte löschen"
                                  : "Konto löschen"
                              }
                            >
                              {deletingAccountId === account.id ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Trash2 className="w-3.5 h-3.5" />
                              )}
                            </button>

                            {/* Deep-Link zu den Einträgen gefiltert nach Konto */}
                            <Link
                              href={`/transactions?bankAccountId=${account.id}`}
                              className="p-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300 transition"
                              title="Buchungen dieses Kontos anzeigen"
                            >
                              <ArrowRight className="w-3.5 h-3.5" />
                            </Link>
                          </div>
                        </div>

                        {/* Historie / Letzte Umsätze Expander */}
                        <div className="px-4 py-2 bg-zinc-50/60 dark:bg-zinc-800/40 border-t border-zinc-100 dark:border-zinc-800/60 flex items-center justify-between text-xs">
                          <button
                            type="button"
                            onClick={() => toggleAccountHistory(account.id)}
                            className="inline-flex items-center gap-1.5 font-medium text-zinc-600 dark:text-zinc-300 hover:text-blue-600 dark:hover:text-blue-400 transition cursor-pointer"
                          >
                            <History className="w-3.5 h-3.5" />
                            <span>
                              {expandedAccountIds[account.id]
                                ? "Umsatz-Historie ausblenden"
                                : `Umsatz-Historie (${account.recentTransactions?.length || 0} Buchungen)`}
                            </span>
                            {expandedAccountIds[account.id] ? (
                              <ChevronDown className="w-3 h-3" />
                            ) : (
                              <ChevronRight className="w-3 h-3" />
                            )}
                          </button>
                          <Link
                            href={`/transactions?bankAccountId=${account.id}`}
                            className="text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1"
                          >
                            <span>Alle Buchungen</span>
                            <ArrowRight className="w-3 h-3" />
                          </Link>
                        </div>

                        {/* Historie Liste wenn aufgeklappt */}
                        {expandedAccountIds[account.id] && (
                          <div className="p-4 bg-zinc-50/30 dark:bg-zinc-900/50 border-t border-zinc-100 dark:border-zinc-800/60 space-y-2">
                            {(!account.recentTransactions || account.recentTransactions.length === 0) ? (
                              <div className="py-4 text-center space-y-2">
                                <p className="text-xs text-zinc-500">
                                  Noch keine Umsätze für dieses Konto in der App vorhanden.
                                </p>
                                <button
                                  type="button"
                                  onClick={() => handleSyncAccount(account.id)}
                                  disabled={isSyncing}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand text-white font-semibold text-xs hover:bg-blue-700 transition cursor-pointer disabled:opacity-50"
                                >
                                  <RefreshCw className={cn("w-3 h-3", isSyncing && "animate-spin")} />
                                  <span>Jetzt Umsätze synchronisieren</span>
                                </button>
                              </div>
                            ) : (
                              <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                                {account.recentTransactions.map((tx) => {
                                  const isIncome = tx.type === "income";
                                  return (
                                    <div
                                      key={tx.id}
                                      className="py-2 flex items-center justify-between gap-3 text-xs"
                                    >
                                      <div className="min-w-0">
                                        <div className="font-medium text-zinc-900 dark:text-zinc-100 truncate">
                                          {tx.merchant || tx.description}
                                        </div>
                                        <div className="flex items-center gap-2 text-xs text-zinc-400">
                                          <span>{formatDateDE(tx.date)}</span>
                                          {tx.categoryName && (
                                            <>
                                              <span>•</span>
                                              <span className="truncate">{tx.categoryName}</span>
                                            </>
                                          )}
                                        </div>
                                      </div>
                                      <div className="flex items-center gap-2 shrink-0">
                                        <div
                                          className={cn(
                                            "font-bold text-xs shrink-0 text-right",
                                            isIncome
                                              ? "text-emerald-600 dark:text-emerald-400"
                                              : "text-zinc-900 dark:text-zinc-100"
                                          )}
                                        >
                                          {isIncome ? "+" : "-"}{formatCents(Math.abs(tx.amountCents))}
                                        </div>
                                        <button
                                          type="button"
                                          onClick={() =>
                                            setRecurringModalPrefill({
                                              transactionId: tx.id,
                                              name: tx.merchant || tx.description,
                                              amountCents: Math.abs(tx.amountCents),
                                              type: tx.type,
                                              categoryId: tx.categoryId,
                                              date: tx.date,
                                            })
                                          }
                                          className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-semibold bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900 transition cursor-pointer"
                                          title="Als wiederkehrende Fixkosten anlegen"
                                        >
                                          <Repeat className="w-3 h-3" />
                                          <span className="hidden sm:inline">Als Fixkosten</span>
                                        </button>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="text-xs text-zinc-500 dark:text-zinc-400 flex items-center gap-1.5">
        <Lock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        Nur Lesezugriff auf Salden und Umsätze. Anmeldung und TAN laufen direkt bei deiner Bank;
        Zugangsdaten werden verschlüsselt gespeichert.
      </p>

      {/* MODAL: Bank auswählen & verbinden */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 duration-150">
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl max-w-lg w-full max-h-[85vh] flex flex-col shadow-lg overflow-hidden">
            {/* Modal Header */}
            <div className="p-5 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-base text-zinc-900 dark:text-zinc-100">
                  Bank oder Kreditkarte verbinden
                </h3>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                  Wähle deine Bank aus.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="p-1.5 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Suche & Filter-Pills */}
            <div className="p-4 border-b border-zinc-100 dark:border-zinc-800 space-y-3">
              <div className="relative">
                <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Bankname suchen (z. B. ING, C24, Sparkasse, TF Bank)..."
                  className="w-full pl-9 pr-3 py-2 text-xs rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setCategoryFilter("all")}
                  className={cn(
                    "px-3 py-1 text-xs font-semibold rounded-lg transition",
                    categoryFilter === "all"
                      ? "bg-brand text-white"
                      : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400"
                  )}
                >
                  Alle
                </button>
                <button
                  type="button"
                  onClick={() => setCategoryFilter("giro")}
                  className={cn(
                    "px-3 py-1 text-xs font-semibold rounded-lg transition",
                    categoryFilter === "giro"
                      ? "bg-brand text-white"
                      : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400"
                  )}
                >
                  Girokonten
                </button>
                <button
                  type="button"
                  onClick={() => setCategoryFilter("credit_card")}
                  className={cn(
                    "px-3 py-1 text-xs font-semibold rounded-lg transition",
                    categoryFilter === "credit_card"
                      ? "bg-brand text-white"
                      : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400"
                  )}
                >
                  Kreditkarten
                </button>
              </div>
            </div>

            {/* Institutsliste */}
            <div className="flex-1 overflow-y-auto p-3 divide-y divide-zinc-100 dark:divide-zinc-800/80">
              {filteredInstitutions.length === 0 ? (
                <div className="p-8 text-center text-xs text-zinc-400">
                  Keine Bank gefunden, die „{searchQuery}“ entspricht.
                </div>
              ) : (
                filteredInstitutions.map((inst) => {
                  const isConnecting = connectingId === inst.id;
                  const isAlreadyConnected = connectedBanks.some(
                    (b) => b.institutionId === inst.id
                  );

                  return (
                    <div
                      key={inst.id}
                      className="p-3 flex items-center justify-between gap-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/40 rounded-xl transition"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div
                          className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold text-xs shrink-0"
                          style={{ backgroundColor: inst.brandColor }}
                        >
                          {inst.name.slice(0, 2).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-xs text-zinc-900 dark:text-zinc-100 truncate">
                              {inst.name}
                            </span>
                            {inst.category === "credit_card" && (
                              <span className="text-xs px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 font-semibold">
                                Kreditkarte
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-zinc-400 truncate">
                            {inst.description}
                          </p>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleConnect(inst)}
                        disabled={isConnecting || isAlreadyConnected}
                        className={cn(
                          "px-3 py-1.5 rounded-xl font-bold text-xs transition flex items-center gap-1.5 shrink-0 cursor-pointer",
                          isAlreadyConnected
                            ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-400 cursor-not-allowed"
                            : "bg-brand text-white hover:opacity-90"
                        )}
                      >
                        {isConnecting ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            <span>Verbinde...</span>
                          </>
                        ) : isAlreadyConnected ? (
                          <>
                            <Check className="w-3.5 h-3.5" />
                            <span>Verbunden</span>
                          </>
                        ) : (
                          <>
                            <span>Verbinden</span>
                            <ChevronRight className="w-3.5 h-3.5" />
                          </>
                        )}
                      </button>
                    </div>
                  );
                })
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-3.5 bg-zinc-50 dark:bg-zinc-900 border-t border-zinc-100 dark:border-zinc-800 text-center text-xs text-zinc-500">
              <span className="flex items-center justify-center gap-1">
                <Lock className="w-3 h-3 text-emerald-600" />
                <span>
                  {isLiveMode
                    ? "Weiterleitung zur Anmeldeseite deiner Bank"
                    : isDemoAvailable
                      ? "Offline-Sandbox-Modus: Simuliert Testkonten & Buchungen"
                      : "Bank-Synchronisation nicht eingerichtet (API-Keys fehlen)"}
                </span>
              </span>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Live-Modus aktivieren & API-Keys Anleitung */}
      {liveInfoOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 duration-150">
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl max-w-lg w-full max-h-[90vh] flex flex-col shadow-lg overflow-hidden">
            <div className="p-5 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 flex items-center justify-center shrink-0">
                  <Key className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-base text-zinc-900 dark:text-zinc-100">
                    Live Open Banking (PSD2) aktivieren
                  </h3>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    Echte Konten von ING, C24, Sparkasse & Co. anbinden
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setLiveInfoOpen(false)}
                className="p-1.5 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs text-zinc-600 dark:text-zinc-300">
              <div className="p-3 rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900/60 text-blue-900 dark:text-blue-200">
                <p className="font-semibold mb-1">
                  Warum sehe ich bisher Demo-Konten?
                </p>
                <p className="text-xs leading-relaxed">
                  Damit Cashflow sofort ohne Registrierung lokal ausprobiert
                  werden kann, startet die App standardmäßig im sicheren
                  Sandbox-Modus. Klickst du auf eine Bank, werden simulierte
                  Beispieldaten erzeugt.
                </p>
              </div>

              <div className="space-y-3">
                <h4 className="font-bold text-zinc-900 dark:text-zinc-100 text-xs">
                  In 3 einfachen Schritten zu echten Bankdaten:
                </h4>

                <div className="flex gap-3">
                  <div className="w-6 h-6 rounded-full bg-brand text-white font-bold flex items-center justify-center shrink-0 text-xs">
                    1
                  </div>
                  <div>
                    <p className="font-semibold text-zinc-900 dark:text-zinc-100">
                      Kostenlosen Enable Banking Account erstellen
                    </p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                      Registriere dich kostenlos auf{" "}
                      <a
                        href="https://enablebanking.com"
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-600 underline font-semibold inline-flex items-center gap-0.5"
                      >
                        enablebanking.com
                        <ExternalLink className="w-2.5 h-2.5" />
                      </a>{" "}
                      und erstelle eine neue Application für persönliche
                      Finanzen.
                    </p>
                  </div>
                </div>

                <div className="flex gap-3">
                  <div className="w-6 h-6 rounded-full bg-brand text-white font-bold flex items-center justify-center shrink-0 text-xs">
                    2
                  </div>
                  <div>
                    <p className="font-semibold text-zinc-900 dark:text-zinc-100">
                      Application ID & Private Key kopieren
                    </p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                      Lade deinen RSA Private Key (<code>key.pem</code>) herunter
                      und notiere deine <code>Application ID</code>.
                    </p>
                  </div>
                </div>

                <div className="flex gap-3">
                  <div className="w-6 h-6 rounded-full bg-brand text-white font-bold flex items-center justify-center shrink-0 text-xs">
                    3
                  </div>
                  <div className="flex-1">
                    <p className="font-semibold text-zinc-900 dark:text-zinc-100">
                      Redirect URL in Enable Banking hinterlegen
                    </p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                      Trage in deiner Enable Banking Application unter{" "}
                      <strong>Redirect URLs</strong> exakt diese URL ein:
                    </p>
                    <div className="mt-1.5 flex items-center gap-2">
                      <code className="flex-1 p-2 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-blue-600 dark:text-blue-400 tabular-nums text-xs break-all select-all border border-zinc-200 dark:border-zinc-700">
                        {typeof window !== "undefined"
                          ? `${window.location.origin}/api/bank-sync/callback`
                          : "http://localhost:3000/api/bank-sync/callback"}
                      </code>
                      <button
                        type="button"
                        onClick={() => {
                          const url = `${window.location.origin}/api/bank-sync/callback`;
                          navigator.clipboard.writeText(url);
                          toast.success("Callback-URL kopiert!");
                        }}
                        className="px-2.5 py-1.5 rounded-lg bg-brand text-white hover:opacity-90 font-bold text-xs shrink-0 transition cursor-pointer"
                      >
                        Kopieren
                      </button>
                    </div>
                  </div>
                </div>

                <div className="flex gap-3">
                  <div className="w-6 h-6 rounded-full bg-brand text-white font-bold flex items-center justify-center shrink-0 text-xs">
                    4
                  </div>
                  <div>
                    <p className="font-semibold text-zinc-900 dark:text-zinc-100">
                      In Docker / .env eintragen & neu starten
                    </p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                      Füge die beiden Variablen in deine{" "}
                      <code>docker-compose.yml</code> oder <code>.env</code> ein:
                    </p>
                    <pre className="mt-2 p-2.5 rounded-xl bg-zinc-900 text-zinc-200 text-xs tabular-nums overflow-x-auto">
                      {`ENABLE_BANKING_APPLICATION_ID="deine-app-uuid"\nENABLE_BANKING_PRIVATE_KEY="/app/key.pem"`}
                    </pre>
                  </div>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 text-emerald-900 dark:text-emerald-200 text-xs leading-relaxed">
                <strong>Nach dem Neustart:</strong> Klickst du auf eine Bank,
                wirst du direkt zum offiziellen Login deiner Hausbank
                weitergeleitet. Nach Bestätigung per Bank-App landen deine echten
                Salden und Umsätze in Cashflow.
              </div>
            </div>

            <div className="p-4 bg-zinc-50 dark:bg-zinc-900 border-t border-zinc-100 dark:border-zinc-800 flex justify-end">
              <button
                type="button"
                onClick={() => setLiveInfoOpen(false)}
                className="px-4 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-white text-white dark:text-zinc-900 text-xs font-bold transition cursor-pointer"
              >
                Verstanden
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Fixkosten direkt aus Buchung anlegen */}
      <CreateRecurringModal
        open={!!recurringModalPrefill}
        onClose={() => setRecurringModalPrefill(null)}
        categories={categories}
        prefill={recurringModalPrefill}
      />

      {/* Modal: Manuelles Konto oder Karte anlegen / bearbeiten */}
      <ManualAccountModal
        open={manualAccountModalOpen}
        onClose={() => {
          setManualAccountModalOpen(false);
          setAccountToEdit(null);
        }}
        accountToEdit={accountToEdit}
      />

      {/* Modal: Kartenausgleich / Umbuchung zwischen Konten */}
      <AccountTransferModal
        open={transferModalOpen}
        onClose={() => {
          setTransferModalOpen(false);
          setTransferDefaultTargetId(null);
        }}
        accounts={allAccounts}
        defaultTargetAccountId={transferDefaultTargetId}
      />

      {/* Modal: Kassensturz & Saldenabgleich für manuelle Konten */}
      <BalanceReconciliationModal
        open={reconciliationModalOpen}
        onClose={() => {
          setReconciliationModalOpen(false);
          setReconciliationAccount(null);
        }}
        account={reconciliationAccount}
      />

      {/* App-eigener Bestätigungsdialog für Banking-Aktionen */}
      <ConfirmModal
        open={Boolean(bankingConfirm)}
        title={bankingConfirm?.title}
        message={bankingConfirm?.message || ""}
        confirmText="Bestätigen"
        cancelText="Abbrechen"
        variant="danger"
        loading={bankingConfirmLoading}
        onCancel={() => setBankingConfirm(null)}
        onConfirm={async () => {
          if (!bankingConfirm) return;
          setBankingConfirmLoading(true);
          try {
            await bankingConfirm.onConfirm();
          } finally {
            setBankingConfirmLoading(false);
          }
        }}
      />
    </div>
  );
}
