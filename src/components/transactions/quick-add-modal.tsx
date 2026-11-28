"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useDialogA11y } from "@/lib/use-dialog-a11y";
import {
  createTransactionAction,
  updateTransactionAction,
  type TransactionInput,
} from "@/actions/transaction-actions";
import { createClientTempId, enqueueOfflineTransaction } from "@/lib/offline-queue";
import {
  centsToInput,
  formatCents,
  parseEuroToCents,
  PAYMENT_METHOD_LABELS,
  todayISO,
} from "@/lib/format";
import { PAYMENT_METHODS, type PaymentMethod } from "@/lib/db/schema";
import { CategoryIcon } from "@/components/ui/category-icon";
import {
  X,
  Check,
  Loader2,
  BookmarkPlus,
  Calendar,
  CreditCard,
  Landmark,
  Camera,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export interface CategoryItem {
  id: string;
  name: string;
  color: string;
  icon: string;
  type: "expense" | "income";
  parentId?: string | null;
}

export interface VariablePresetItem {
  id: string;
  name: string;
  categoryId: string;
  type: "expense" | "income";
  defaultAmountCents: number | null;
  paymentMethod: PaymentMethod;
  usageCount: number;
}

export interface BankAccountItem {
  id: string;
  accountName: string;
  accountType?: string | null;
  balanceCents?: number | null;
  ibanMasked?: string | null;
}

export interface EditableTransaction {
  id: string;
  categoryId: string;
  type: "expense" | "income";
  costType: "variable" | "fixed" | "transfer";
  amountCents: number;
  date: string;
  description: string;
  merchant?: string | null;
  paymentMethod: PaymentMethod;
  receiptPath?: string | null;
  bankAccountId?: string | null;
}

export function QuickAddModal({
  open,
  onClose,
  categories,
  presets,
  bankAccounts,
  editTransaction,
  defaultPaymentMethod = "card",
}: {
  open: boolean;
  /** Vorgabe aus den Admin-Einstellungen */
  defaultPaymentMethod?: PaymentMethod;
  onClose: () => void;
  categories: CategoryItem[];
  presets: VariablePresetItem[];
  bankAccounts?: BankAccountItem[];
  editTransaction?: EditableTransaction | null;
}) {
  const amountInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [type, setType] = useState<"expense" | "income">("expense");
  const [costType, setCostType] = useState<"variable" | "fixed" | "transfer">("variable");
  const [amountStr, setAmountStr] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(todayISO());
  const [paymentMethod, setPaymentMethod] =
    useState<PaymentMethod>(defaultPaymentMethod);
  const [receiptPath, setReceiptPath] = useState<string | null>(null);
  const [bankAccountId, setBankAccountId] = useState<string | null>(null);
  const [newlyUploadedReceipt, setNewlyUploadedReceipt] = useState<
    string | null
  >(null);
  const [uploadingReceipt, setUploadingReceipt] = useState(false);
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const [saveAsPreset, setSaveAsPreset] = useState(false);
  const [savePresetWithAmount, setSavePresetWithAmount] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const filteredCategories = categories.filter((c) => c.type === type);

  const sortedPresets = useMemo(
    () => [...presets].sort((a, b) => (b.usageCount || 0) - (a.usageCount || 0)),
    [presets]
  );

  const dateQuickOptions = useMemo(() => {
    const getOffsetISO = (offsetDays: number) => {
      const d = new Date();
      d.setDate(d.getDate() - offsetDays);
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    };
    return [
      { label: "Heute", value: getOffsetISO(0) },
      { label: "Gestern", value: getOffsetISO(1) },
      { label: "Vorgestern", value: getOffsetISO(2) },
    ];
  }, []);

  useEffect(() => {
    if (!open) return;

    if (editTransaction) {
      setType(editTransaction.type);
      setCostType(editTransaction.costType);
      setAmountStr(centsToInput(editTransaction.amountCents));
      setCategoryId(editTransaction.categoryId);
      setDescription(editTransaction.description);
      setDate(editTransaction.date);
      setPaymentMethod(editTransaction.paymentMethod);
      setReceiptPath(editTransaction.receiptPath || null);
      setBankAccountId(editTransaction.bankAccountId || null);
      setNewlyUploadedReceipt(null);
      setSelectedPresetId(null);
      setSaveAsPreset(false);
    } else {
      setType("expense");
      setCostType("variable");
      setAmountStr("");
      const defaultCat =
        categories.find((c) => c.type === "expense")?.id ||
        categories[0]?.id ||
        "";
      setCategoryId(defaultCat);
      setDescription("");
      setDate(todayISO());
      setPaymentMethod(defaultPaymentMethod);
      setReceiptPath(null);
      setBankAccountId(null);
      setNewlyUploadedReceipt(null);
      setSelectedPresetId(null);
      setSaveAsPreset(false);
      setSavePresetWithAmount(false);
    }

    setTimeout(() => {
      amountInputRef.current?.focus();
    }, 80);
  }, [open, editTransaction, categories]);

  const { dialogProps } = useDialogA11y({ open, onClose });
  if (!open) return null;

  function handleSelectPreset(preset: VariablePresetItem) {
    setSelectedPresetId(preset.id);
    setType(preset.type);
    setCostType("variable");
    setCategoryId(preset.categoryId);
    setDescription(preset.name);
    setPaymentMethod(preset.paymentMethod);
    if (preset.defaultAmountCents) {
      setAmountStr(centsToInput(preset.defaultAmountCents));
    } else {
      amountInputRef.current?.focus();
    }
  }

  async function handleReceiptChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (typeof navigator !== "undefined" && !navigator.onLine) {
      toast.error("Belegfoto-Upload erfordert eine aktive Verbindung.");
      return;
    }

    setUploadingReceipt(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/receipts/upload", {
        method: "POST",
        body: formData,
      });
      const json = await res.json();

      if (!res.ok || !json.receiptPath) {
        toast.error(json.error || "Upload fehlgeschlagen.");
      } else {
        // Falls bereits ein ungespeichertes Foto in dieser Sitzung hochgeladen wurde -> altes sofort löschen
        if (newlyUploadedReceipt) {
          fetch(`/api/receipts/${newlyUploadedReceipt}`, {
            method: "DELETE",
          }).catch(() => {});
        }
        setReceiptPath(json.receiptPath);
        setNewlyUploadedReceipt(json.receiptPath);
        toast.success("Belegfoto komprimiert & angehängt!");
      }
    } catch {
      toast.error("Fehler beim Hochladen des Belegfotos.");
    } finally {
      setUploadingReceipt(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const amountCents = parseEuroToCents(amountStr);
    if (!amountCents) {
      toast.error("Bitte einen gültigen Betrag eingeben (z. B. 12,50).");
      amountInputRef.current?.focus();
      return;
    }

    const activeCat = categories.find((c) => c.id === categoryId);
    const finalDescription =
      description.trim() || activeCat?.name || "Ausgabe";

    setSubmitting(true);

    const payload: TransactionInput = {
      id: editTransaction?.id,
      categoryId,
      type,
      costType,
      amountCents,
      date,
      description: finalDescription,
      paymentMethod,
      receiptPath,
      bankAccountId: bankAccountId || null,
      presetId: selectedPresetId,
      saveAsPreset: !editTransaction && !selectedPresetId && saveAsPreset,
      savePresetWithAmount,
      // Vor dem ersten Senden vergeben: Geht die Antwort verloren und landet die
      // Buchung in der Offline-Queue, erkennt der Server sie beim erneuten
      // Senden an derselben ID statt sie doppelt anzulegen
      clientTempId: editTransaction ? undefined : createClientTempId(),
    };

    if (
      !editTransaction &&
      typeof navigator !== "undefined" &&
      !navigator.onLine
    ) {
      await enqueueOfflineTransaction(payload);
      toast.success(
        `${formatCents(amountCents)} offline gespeichert (wird bei Verbindung synchronisiert)!`
      );
      setSubmitting(false);
      onClose();
      return;
    }

    try {
      const res = editTransaction
        ? await updateTransactionAction(payload)
        : await createTransactionAction(payload);

      if (!res.success) {
        toast.error(res.error || "Speichern fehlgeschlagen.");
        setSubmitting(false);
        return;
      }

      if (typeof navigator !== "undefined" && "vibrate" in navigator) {
        try {
          navigator.vibrate?.(15);
        } catch {}
      }

      toast.success(
        editTransaction
          ? "Eintrag aktualisiert!"
          : `${formatCents(amountCents)} gespeichert!`
      );
      setSubmitting(false);
      onClose();
    } catch {
      if (!editTransaction) {
        await enqueueOfflineTransaction(payload);
        toast.info(
          "Keine Verbindung – Eintrag wurde offline gespeichert und wird automatisch synchronisiert."
        );
        setSubmitting(false);
        onClose();
        return;
      }
      toast.error("Fehler beim Speichern.");
      setSubmitting(false);
    }
  }

  function handleCancelModal() {
    if (newlyUploadedReceipt) {
      fetch(`/api/receipts/${newlyUploadedReceipt}`, {
        method: "DELETE",
      }).catch(() => {});
      setNewlyUploadedReceipt(null);
    }
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 duration-150">
      <div
        {...dialogProps}
        aria-labelledby={undefined}
        aria-label={editTransaction ? "Buchung bearbeiten" : "Buchung erfassen"}
        className="w-full max-w-lg bg-white dark:bg-zinc-900 rounded-t-3xl sm:rounded-xl border-t sm:border border-zinc-200 dark:border-zinc-800 shadow-lg max-h-[92dvh] overflow-y-auto pb-safe"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Mobile Bottom Sheet Drag Handle */}
        <div className="w-10 h-1 bg-zinc-300 dark:bg-zinc-700 rounded-full mx-auto my-2 shrink-0 sm:hidden" />

        {/* Header */}
        <div className="sticky top-0 z-10 bg-white/95 dark:bg-zinc-900/95 px-5 py-3.5 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-1.5 bg-zinc-100 dark:bg-zinc-800 p-1 rounded-xl">
            <button
              type="button"
              onClick={() => {
                setType("expense");
                const firstExp = categories.find((c) => c.type === "expense");
                if (firstExp) setCategoryId(firstExp.id);
              }}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-semibold transition",
                type === "expense"
                  ? "bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white "
                  : "text-zinc-500"
              )}
            >
              Ausgabe
            </button>
            <button
              type="button"
              onClick={() => {
                setType("income");
                const firstInc = categories.find((c) => c.type === "income");
                if (firstInc) setCategoryId(firstInc.id);
              }}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-semibold transition",
                type === "income"
                  ? "bg-brand text-white "
                  : "text-zinc-500"
              )}
            >
              Einnahme
            </button>
          </div>

          <button
            aria-label="Schließen"
            type="button"
            onClick={handleCancelModal}
            className="p-2 rounded-full text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-5">
          {/* 1. Vorlagen (nach Häufigkeit sortiert) */}
          {!editTransaction && type === "expense" && sortedPresets.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                  Vorlagen
                </span>
                {selectedPresetId && (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedPresetId(null);
                      setDescription("");
                      setAmountStr("");
                    }}
                    className="text-xs text-blue-600 dark:text-blue-400 font-medium"
                  >
                    Zurücksetzen
                  </button>
                )}
              </div>
              <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
                {sortedPresets.map((preset) => {
                  const isSelected = selectedPresetId === preset.id;
                  const cat = categories.find((c) => c.id === preset.categoryId);
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => handleSelectPreset(preset)}
                      className={cn(
                        "shrink-0 px-3 py-2 rounded-xl border text-left transition flex items-center gap-2",
                        isSelected
                          ? "border-zinc-900 bg-zinc-50 ring-1 ring-zinc-900 dark:border-zinc-100 dark:bg-zinc-800/60 dark:ring-zinc-100"
                          : "border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 hover:border-zinc-300"
                      )}
                    >
                      <span
                        className="w-6 h-6 rounded-full flex items-center justify-center bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 shrink-0"
                      >
                        <CategoryIcon
                          name={cat?.icon || "ShoppingCart"}
                          className="w-3.5 h-3.5"
                        />
                      </span>
                      <div>
                        <p className="text-xs font-semibold leading-tight">
                          {preset.name}
                        </p>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">
                          {preset.defaultAmountCents
                            ? formatCents(preset.defaultAmountCents)
                            : "Betrag frei"}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* 2. Großes Betragsfeld (inputMode="decimal" für numerische iOS-Tastatur) */}
          <div className="bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg p-4 flex items-center justify-between">
            <div className="flex-1">
              <label className="block text-xs font-medium text-zinc-500">
                Betrag in EUR
              </label>
              <div className="flex items-baseline gap-2 mt-1">
                <input
                  ref={amountInputRef}
                  type="text"
                  inputMode="decimal"
                  required
                  value={amountStr}
                  onChange={(e) => setAmountStr(e.target.value)}
                  placeholder="0,00"
                  className="w-full text-3xl font-bold tracking-tight bg-transparent focus:outline-none text-zinc-900 dark:text-white"
                />
                <span className="text-2xl font-bold text-zinc-400">€</span>
              </div>
            </div>
          </div>

          {/* 3. Kategorien als Touch-Grid */}
          <div>
            <label className="block text-xs font-semibold text-zinc-500 dark:text-zinc-400 mb-2">
              Kategorie wählen
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-52 overflow-y-auto pr-1">
              {filteredCategories.map((cat) => {
                const active = cat.id === categoryId;
                const parentCat = cat.parentId
                  ? categories.find((c) => c.id === cat.parentId)
                  : null;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setCategoryId(cat.id)}
                    className={cn(
                      "p-2.5 rounded-xl border text-left flex items-center gap-2 transition",
                      active
                        ? "border-zinc-900 bg-zinc-50 ring-1 ring-zinc-900 dark:border-zinc-100 dark:bg-zinc-800/60 dark:ring-zinc-100"
                        : "border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950"
                    )}
                  >
                    <span
                      className="w-7 h-7 rounded-full flex items-center justify-center bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 shrink-0"
                    >
                      <CategoryIcon name={cat.icon} className="w-4 h-4" />
                    </span>
                    <div className="flex flex-col min-w-0">
                      {parentCat && (
                        <span className="text-xs text-zinc-400 truncate leading-tight">
                          {parentCat.name} ›
                        </span>
                      )}
                      <span className="text-xs font-medium truncate">
                        {cat.name}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 4. Beschreibung (oder Freitext-Neueintrag) */}
          <div>
            <label className="block text-xs font-semibold text-zinc-500 dark:text-zinc-400 mb-1.5">
              Beschreibung / Verwendungszweck
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
                if (selectedPresetId) setSelectedPresetId(null);
              }}
              placeholder="z. B. Bäcker, REWE Einkauf, Tanken (optional)"
              className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />

            {!editTransaction &&
              !selectedPresetId &&
              type === "expense" &&
              description.trim().length > 1 && (
                <div className="mt-2.5 p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 space-y-2">
                  <label className="flex items-center gap-2 text-xs font-medium text-amber-800 dark:text-amber-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={saveAsPreset}
                      onChange={(e) => setSaveAsPreset(e.target.checked)}
                      className="rounded border-amber-400 text-blue-600 focus:ring-blue-500"
                    />
                    <BookmarkPlus className="w-3.5 h-3.5" />
                    <span>
                      „{description.trim()}“ als Vorlage für variable Kosten
                      speichern
                    </span>
                  </label>
                  {saveAsPreset && (
                    <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400 pl-6 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={savePresetWithAmount}
                        onChange={(e) =>
                          setSavePresetWithAmount(e.target.checked)
                        }
                        className="rounded"
                      />
                      <span>
                        Aktuellen Betrag als festen Standardbetrag hinterlegen
                      </span>
                    </label>
                  )}
                </div>
              )}
          </div>

          {/* 5. Datum & Zahlungsart */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="quick-add-date"
                className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 flex items-center gap-1 mb-1.5"
              >
                <Calendar className="w-3.5 h-3.5" aria-hidden="true" />
                Datum
              </label>
              <input
                id="quick-add-date"
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950"
              />
              <div className="flex items-center gap-1.5 mt-1.5" role="group" aria-label="Datum schnell wählen">
                {dateQuickOptions.map((opt) => {
                  const isSelected = date === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setDate(opt.value)}
                      aria-pressed={isSelected}
                      className={cn(
                        "text-xs px-2 py-1 rounded-md transition-colors",
                        isSelected
                          ? "bg-brand text-white"
                          : "bg-zinc-100 hover:bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:hover:bg-zinc-700 dark:text-zinc-400"
                      )}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-500 dark:text-zinc-400 mb-1.5 flex items-center gap-1">
                <CreditCard className="w-3.5 h-3.5" />
                Zahlungsart
              </label>
              <select
                value={paymentMethod}
                onChange={(e) =>
                  setPaymentMethod(e.target.value as PaymentMethod)
                }
                className="w-full px-3 py-2 text-sm rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950"
              >
                {PAYMENT_METHODS.map((pm) => (
                  <option key={pm} value={pm}>
                    {PAYMENT_METHOD_LABELS[pm]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Geldquelle / Bankkonto-Zuordnung (Optional) */}
          {bankAccounts && bankAccounts.length > 0 && (
            <div>
              <label className="block text-xs font-semibold text-zinc-500 dark:text-zinc-400 mb-1.5 flex items-center justify-between">
                <span className="flex items-center gap-1">
                  <Landmark className="w-3.5 h-3.5" />
                  Geldquelle / Konto
                </span>
                <span className="text-xs text-zinc-400 font-normal">
                  Aktualisiert Kontosaldo automatisch
                </span>
              </label>
              <select
                value={bankAccountId || ""}
                onChange={(e) => setBankAccountId(e.target.value || null)}
                className="w-full px-3 py-2 text-sm rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-zinc-800 dark:text-zinc-200"
              >
                <option value="">Ohne Kontozuordnung (Lokal)</option>
                {bankAccounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.accountName}{" "}
                    {acc.balanceCents !== null && acc.balanceCents !== undefined
                      ? `(${formatCents(acc.balanceCents)})`
                      : ""}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* 6. Optionales Belegfoto (iPhone Kamera capture="environment", serverseitig per sharp komprimiert) */}
          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleReceiptChange}
              className="hidden"
            />
            {!receiptPath ? (
              <button
                type="button"
                disabled={uploadingReceipt}
                onClick={() => fileInputRef.current?.click()}
                className="w-full py-2.5 px-3.5 rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700 text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 flex items-center justify-center gap-2 transition"
              >
                {uploadingReceipt ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                    <span>Komprimiere Belegfoto...</span>
                  </>
                ) : (
                  <>
                    <Camera className="w-4 h-4 text-blue-600" />
                    <span>Optional: Belegfoto aufnehmen / anhängen</span>
                  </>
                )}
              </button>
            ) : (
              <div className="p-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <img
                    src={`/api/receipts/${receiptPath}`}
                    alt="Beleg"
                    className="w-11 h-11 rounded-lg object-cover border border-zinc-200 dark:border-zinc-700"
                  />
                  <div>
                    <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                      Belegfoto angehängt (.webp)
                    </p>
                    <a
                      href={`/api/receipts/${receiptPath}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-blue-600 hover:underline"
                    >
                      In voller Größe öffnen
                    </a>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (
                      !window.confirm(
                        "Möchtest du das angehängte Belegfoto wirklich entfernen?"
                      )
                    ) {
                      return;
                    }
                    if (newlyUploadedReceipt) {
                      fetch(`/api/receipts/${newlyUploadedReceipt}`, {
                        method: "DELETE",
                      }).catch(() => {});
                      setNewlyUploadedReceipt(null);
                    }
                    setReceiptPath(null);
                    toast.info("Belegfoto entfernt.");
                  }}
                  className="p-1.5 rounded-lg text-red-600 hover:bg-red-500/10"
                  title="Beleg entfernen"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={submitting || uploadingReceipt}
            className="w-full py-3.5 px-4 rounded-lg bg-zinc-900 hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300 active:scale-[0.99] text-white font-bold text-base flex items-center justify-center gap-2 transition disabled:opacity-60"
          >
            {submitting ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <>
                <Check className="w-5 h-5" />
                <span>
                  {editTransaction ? "Änderungen speichern" : "Jetzt speichern"}
                </span>
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
