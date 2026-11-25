"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  saveCategoryAction,
  deleteOrArchiveCategoryAction,
  saveVariablePresetAction,
  deleteVariablePresetAction,
} from "@/actions/category-actions";
import { saveBudgetAction } from "@/actions/budget-actions";
import {
  AVAILABLE_ICON_NAMES,
  CATEGORY_COLORS,
  CategoryIcon,
} from "@/components/ui/category-icon";
import {
  centsToInput,
  formatCents,
  parseEuroToCents,
  PAYMENT_METHOD_LABELS,
} from "@/lib/format";
import { PAYMENT_METHODS, type PaymentMethod } from "@/lib/db/schema";
import type {
  CategoryItem,
  VariablePresetItem,
} from "@/components/transactions/quick-add-modal";
import {
  Tag,
  Wallet,
  Plus,
  Pencil,
  Trash2,
  Check,
  X,
  Zap,
  Play,
  Loader2,
  PackageCheck,
} from "lucide-react";
import {
  createCategoryRuleAction,
  updateCategoryRuleAction,
  deleteCategoryRuleAction,
  applyCategoryRulesAction,
  seedDefaultCategoryRulesAction,
  toggleCategoryRuleActiveAction,
  toggleAllCategoryRulesAction,
} from "@/actions/category-rule-actions";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export interface BudgetItem {
  id: string;
  categoryId: string | null;
  amountCents: number;
}

export interface CategoryRuleItem {
  id: string;
  name: string | null;
  pattern: string;
  matchField: string;
  categoryId: string;
  costType: string | null;
  priority: number;
  isActive: boolean;
}

export function CategoriesAndPresetsView({
  categories,
  presets,
  budgets = [],
  rules = [],
}: {
  categories: CategoryItem[];
  presets: VariablePresetItem[];
  budgets?: BudgetItem[];
  rules?: CategoryRuleItem[];
}) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<
    "presets" | "categories" | "rules" | "budgets"
  >("presets");

  // State für Variable-Kosten-Vorlage
  const [presetId, setPresetId] = useState<string | undefined>(undefined);
  const [presetName, setPresetName] = useState("");
  const [presetCatId, setPresetCatId] = useState(
    categories.find((c) => c.type === "expense")?.id || categories[0]?.id || ""
  );
  const [presetAmountStr, setPresetAmountStr] = useState("");
  const [presetPayment, setPresetPayment] =
    useState<PaymentMethod>("card");
  const [showPresetForm, setShowPresetForm] = useState(false);

  // State für Kategorie
  const [catId, setCatId] = useState<string | undefined>(undefined);
  const [catName, setCatName] = useState("");
  const [catParentId, setCatParentId] = useState<string | null>(null);
  const [catColor, setCatColor] = useState(CATEGORY_COLORS[0]);
  const [catIcon, setCatIcon] = useState("ShoppingCart");
  const [catType, setCatType] = useState<"expense" | "income">("expense");
  const [showCatForm, setShowCatForm] = useState(false);

  // State für Budgets pro Kategorie
  const budgetMap = Object.fromEntries(
    budgets.map((b) => [b.categoryId || "GLOBAL", b.amountCents])
  );
  const [budgetInputs, setBudgetInputs] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      budgets.map((b) => [
        b.categoryId || "GLOBAL",
        centsToInput(b.amountCents),
      ])
    )
  );

  // State für Auto-Regeln
  const [ruleId, setRuleId] = useState<string | undefined>(undefined);
  const [ruleName, setRuleName] = useState("");
  const [rulePattern, setRulePattern] = useState("");
  const [ruleMatchField, setRuleMatchField] = useState<
    "all" | "merchant" | "description" | "remittance"
  >("all");
  const [ruleCatId, setRuleCatId] = useState(categories[0]?.id || "");
  const [ruleCostType, setRuleCostType] = useState<
    "variable" | "fixed" | "transfer"
  >("variable");
  const [showRuleForm, setShowRuleForm] = useState(false);
  const [isApplyingRules, setIsApplyingRules] = useState(false);
  const [isSeedingRules, setIsSeedingRules] = useState(false);

  async function handleSeedDefaultRules() {
    setIsSeedingRules(true);
    try {
      const res = await seedDefaultCategoryRulesAction();
      if (res.success) {
        toast.success(res.message);
        router.refresh();
      } else {
        toast.error(res.error || "Fehler beim Laden der Standard-Regeln.");
      }
    } catch {
      toast.error("Unerwarteter Fehler.");
    } finally {
      setIsSeedingRules(false);
    }
  }

  function openNewRule() {
    setRuleId(undefined);
    setRuleName("");
    setRulePattern("");
    setRuleMatchField("all");
    setRuleCatId(categories[0]?.id || "");
    setRuleCostType("variable");
    setShowRuleForm(true);
  }

  function openEditRule(r: CategoryRuleItem) {
    setRuleId(r.id);
    setRuleName(r.name || "");
    setRulePattern(r.pattern);
    setRuleMatchField(
      (r.matchField as "all" | "merchant" | "description" | "remittance") ||
        "all"
    );
    setRuleCatId(r.categoryId);
    setRuleCostType((r.costType as "variable" | "fixed" | "transfer") || "variable");
    setShowRuleForm(true);
  }

  async function handleSaveRule(e: React.FormEvent) {
    e.preventDefault();
    if (!rulePattern.trim()) {
      toast.error("Bitte ein Suchmuster / Begriff eingeben.");
      return;
    }

    if (ruleId) {
      const res = await updateCategoryRuleAction({
        id: ruleId,
        name: ruleName.trim() || null,
        pattern: rulePattern.trim(),
        matchField: ruleMatchField,
        categoryId: ruleCatId,
        costType: ruleCostType,
      });
      if (res.success) {
        toast.success("Regel aktualisiert.");
        setShowRuleForm(false);
      } else {
        toast.error(res.error || "Fehler beim Aktualisieren.");
      }
    } else {
      const res = await createCategoryRuleAction({
        name: ruleName.trim() || null,
        pattern: rulePattern.trim(),
        matchField: ruleMatchField,
        categoryId: ruleCatId,
        costType: ruleCostType,
      });
      if (res.success) {
        toast.success("Auto-Kategorisierungs-Regel angelegt.");
        setShowRuleForm(false);
      } else {
        toast.error(res.error || "Fehler beim Anlegen.");
      }
    }
  }

  async function handleToggleRule(id: string) {
    const res = await toggleCategoryRuleActiveAction(id);
    if (res.success) {
      toast.success(res.isActive ? "Regel aktiviert." : "Regel pausiert.");
      router.refresh();
    } else {
      toast.error(res.error || "Fehler beim Umschalten.");
    }
  }

  async function handleToggleAllRules(active: boolean) {
    const res = await toggleAllCategoryRulesAction(active);
    if (res.success) {
      toast.success(active ? "Alle Regeln aktiviert." : "Alle Regeln pausiert.");
      router.refresh();
    } else {
      toast.error("Fehler beim Umschalten.");
    }
  }

  const [deleteConfirm, setDeleteConfirm] = useState<{
    title: string;
    message: string;
    onConfirm: () => Promise<void>;
  } | null>(null);
  const [isDeletingConfirm, setIsDeletingConfirm] = useState(false);

  function handleDeleteRule(id: string) {
    setDeleteConfirm({
      title: "Regel löschen",
      message: "Möchtest du diese Auto-Kategorisierungsregel wirklich unwiderruflich löschen?",
      onConfirm: async () => {
        const res = await deleteCategoryRuleAction(id);
        if (res.success) {
          toast.success("Regel gelöscht.");
          setDeleteConfirm(null);
        } else {
          toast.error(res.error || "Fehler beim Löschen.");
        }
      },
    });
  }

  async function handleApplyRules() {
    setIsApplyingRules(true);
    try {
      const res = await applyCategoryRulesAction();
      if (res.success) {
        toast.success(res.message || "Regeln erfolgreich angewendet!");
      } else {
        toast.error(res.error || "Fehler beim Anwenden.");
      }
    } catch {
      toast.error("Fehler beim Anwenden der Regeln.");
    } finally {
      setIsApplyingRules(false);
    }
  }

  function openNewPreset() {
    setPresetId(undefined);
    setPresetName("");
    setPresetCatId(
      categories.find((c) => c.type === "expense")?.id ||
        categories[0]?.id ||
        ""
    );
    setPresetAmountStr("");
    setPresetPayment("card");
    setShowPresetForm(true);
  }

  function openEditPreset(p: VariablePresetItem) {
    setPresetId(p.id);
    setPresetName(p.name);
    setPresetCatId(p.categoryId);
    setPresetAmountStr(centsToInput(p.defaultAmountCents));
    setPresetPayment(p.paymentMethod);
    setShowPresetForm(true);
  }

  async function handleSavePreset(e: React.FormEvent) {
    e.preventDefault();
    const defaultAmountCents = presetAmountStr.trim()
      ? parseEuroToCents(presetAmountStr)
      : null;

    if (presetAmountStr.trim() && !defaultAmountCents) {
      toast.error("Ungültiger Standardbetrag.");
      return;
    }

    const res = await saveVariablePresetAction({
      id: presetId,
      name: presetName,
      categoryId: presetCatId,
      type: "expense",
      defaultAmountCents,
      paymentMethod: presetPayment,
    });

    if (res.success) {
      toast.success(
        presetId
          ? "Vorlage für variable Kosten aktualisiert!"
          : "Neue Vorlage für variable Kosten angelegt!"
      );
      setShowPresetForm(false);
    } else {
      toast.error(res.error || "Speichern fehlgeschlagen.");
    }
  }

  function openNewCategory() {
    setCatId(undefined);
    setCatName("");
    setCatParentId(null);
    setCatColor(CATEGORY_COLORS[0]);
    setCatIcon("ShoppingCart");
    setCatType("expense");
    setShowCatForm(true);
  }

  function openEditCategory(c: CategoryItem) {
    setCatId(c.id);
    setCatName(c.name);
    setCatParentId(c.parentId || null);
    setCatColor(c.color);
    setCatIcon(c.icon);
    setCatType(c.type);
    setShowCatForm(true);
  }

  async function handleSaveCategory(e: React.FormEvent) {
    e.preventDefault();
    const res = await saveCategoryAction({
      id: catId,
      name: catName,
      parentId: catParentId,
      color: catColor,
      icon: catIcon,
      type: catType,
    });

    if (res.success) {
      toast.success(catId ? "Kategorie aktualisiert!" : "Kategorie erstellt!");
      setShowCatForm(false);
    } else {
      toast.error(res.error || "Speichern fehlgeschlagen.");
    }
  }

  async function handleSaveSingleBudget(key: string, categoryId: string | null) {
    const raw = (budgetInputs[key] || "").trim();
    const amountCents = raw === "" || raw === "0" ? 0 : parseEuroToCents(raw);

    if (raw !== "" && raw !== "0" && amountCents === null) {
      toast.error("Bitte gültigen Euro-Betrag eingeben.");
      return;
    }

    const res = await saveBudgetAction({
      categoryId,
      amountCents: amountCents ?? 0,
    });

    if (res.success) {
      toast.success(
        amountCents && amountCents > 0
          ? `Monatsbudget (${formatCents(amountCents)}) gespeichert!`
          : "Monatsbudget entfernt."
      );
    } else {
      toast.error(res.error || "Fehler beim Speichern.");
    }
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-12">
      {/* 4-Tab-Umschalter: Variable Vorlagen | Kategorien | Auto-Regeln | Monatsbudgets (Open Canvas) */}
      <div className="bg-zinc-100 dark:bg-zinc-800/80 rounded-lg p-1.5 grid grid-cols-2 sm:grid-cols-4 gap-1.5">
        <button
          type="button"
          onClick={() => setActiveTab("presets")}
          className={cn(
            "py-2.5 px-2 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition",
            activeTab === "presets"
              ? "bg-brand text-white "
              : "text-zinc-600 dark:text-zinc-400"
          )}
        >
          <span className="truncate">Vorlagen</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("categories")}
          className={cn(
            "py-2.5 px-2 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition",
            activeTab === "categories"
              ? "bg-brand text-white "
              : "text-zinc-600 dark:text-zinc-400"
          )}
        >
          <Tag className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">Kategorien</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("rules")}
          className={cn(
            "py-2.5 px-2 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition",
            activeTab === "rules"
              ? "bg-brand text-white "
              : "text-zinc-600 dark:text-zinc-400"
          )}
        >
          <Zap className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">Auto-Regeln ({rules.length})</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("budgets")}
          className={cn(
            "py-2.5 px-2 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition",
            activeTab === "budgets"
              ? "bg-brand text-white "
              : "text-zinc-600 dark:text-zinc-400"
          )}
        >
          <Wallet className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">Budgets</span>
        </button>
      </div>

      {activeTab === "presets" && (
        <div className="space-y-4">
          <div className="pb-4 border-b border-zinc-200/80 dark:border-zinc-800 flex items-center justify-between">
            <div>
              <h1 className="text-base font-semibold">
                Vordefinierte variable Kosten
              </h1>
              <p className="text-xs text-zinc-500 mt-0.5">
                Erscheinen beim „+“-Button zur 1-Tap-Schnellauswahl (optional mit
                Standardbetrag).
              </p>
            </div>
            <button
              type="button"
              onClick={openNewPreset}
              className="px-3 py-2 rounded-xl bg-brand text-white hover:opacity-90 text-xs font-semibold flex items-center gap-1.5 shrink-0"
            >
              <Plus className="w-4 h-4" />
              <span>Vorlage</span>
            </button>
          </div>

          {showPresetForm && (
            <form
              onSubmit={handleSavePreset}
              className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-4 space-y-3"
            >
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-sm">
                  {presetId
                    ? "Variable Vorlage bearbeiten"
                    : "Neue variable Kosten-Vorlage"}
                </h2>
                <button
                  type="button"
                  onClick={() => setShowPresetForm(false)}
                  className="p-1 text-zinc-400"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-zinc-500 mb-1">
                    Bezeichnung (z. B. Bäcker, Tanken, Kantine)
                  </label>
                  <input
                    type="text"
                    required
                    value={presetName}
                    onChange={(e) => setPresetName(e.target.value)}
                    placeholder="z. B. Bäcker & Kaffee"
                    className="w-full px-3 py-2 text-sm rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-500 mb-1">
                    Standardbetrag in € (optional)
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={presetAmountStr}
                    onChange={(e) => setPresetAmountStr(e.target.value)}
                    placeholder="Leer lassen, falls jedes Mal anders"
                    className="w-full px-3 py-2 text-sm rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950"
                  />
                </div>
              </div>

              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-zinc-500 mb-1">
                    Kategorie
                  </label>
                  <select
                    value={presetCatId}
                    onChange={(e) => setPresetCatId(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950"
                  >
                    {categories
                      .filter((c) => c.type === "expense")
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-500 mb-1">
                    Standard-Zahlungsart
                  </label>
                  <select
                    value={presetPayment}
                    onChange={(e) =>
                      setPresetPayment(e.target.value as PaymentMethod)
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

              <button
                type="submit"
                className="w-full py-2.5 rounded-xl bg-brand text-white hover:opacity-90 text-xs font-semibold flex items-center justify-center gap-1.5"
              >
                <Check className="w-4 h-4" />
                <span>Vorlage speichern</span>
              </button>
            </form>
          )}

          <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {presets.map((p) => {
              const cat = categories.find((c) => c.id === p.categoryId);
              return (
                <div
                  key={p.id}
                  className="p-3.5 flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="w-9 h-9 rounded-full flex items-center justify-center bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 shrink-0"
                    >
                      <CategoryIcon
                        name={cat?.icon || "ShoppingCart"}
                        className="w-4 h-4"
                      />
                    </div>
                    <div>
                      <p className="font-semibold text-sm">{p.name}</p>
                      <p className="text-xs text-zinc-500">
                        {cat?.name} •{" "}
                        {p.defaultAmountCents
                          ? `Standard: ${formatCents(p.defaultAmountCents)}`
                          : "Betrag variabel"}{" "}
                        • {PAYMENT_METHOD_LABELS[p.paymentMethod]}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => openEditPreset(p)}
                      className="p-2 rounded-lg text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDeleteConfirm({
                          title: "Vorlage löschen",
                          message: `Möchtest du die Vorlage „${p.name}“ wirklich löschen?`,
                          onConfirm: async () => {
                            const res = await deleteVariablePresetAction(p.id);
                            if (res.success) {
                              toast.success("Vorlage gelöscht.");
                              setDeleteConfirm(null);
                            } else {
                              toast.error(
                                res.error || "Fehler beim Löschen der Vorlage."
                              );
                            }
                          },
                        });
                      }}
                      className="p-2 rounded-lg text-red-600 hover:bg-red-500/10 cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {activeTab === "categories" && (
        <div className="space-y-4">
          <div className="pb-4 border-b border-zinc-200/80 dark:border-zinc-800 flex items-center justify-between">
            <div>
              <h1 className="text-base font-semibold">Kategorien verwalten</h1>
              <p className="text-xs text-zinc-500 mt-0.5">
                Name, Farbe und Icon für Ausgaben & Einnahmen anpassen.
              </p>
            </div>
            <button
              type="button"
              onClick={openNewCategory}
              className="px-3 py-2 rounded-xl bg-brand text-white hover:opacity-90 text-xs font-semibold flex items-center gap-1.5 shrink-0"
            >
              <Plus className="w-4 h-4" />
              <span>Kategorie</span>
            </button>
          </div>

          {showCatForm && (
            <form
              onSubmit={handleSaveCategory}
              className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-4 space-y-4"
            >
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-sm">
                  {catId ? "Kategorie bearbeiten" : "Neue Kategorie"}
                </h2>
                <button
                  type="button"
                  onClick={() => setShowCatForm(false)}
                  className="p-1 text-zinc-400"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-zinc-500 mb-1">
                    Name
                  </label>
                  <input
                    type="text"
                    required
                    value={catName}
                    onChange={(e) => setCatName(e.target.value)}
                    placeholder="z. B. Haustier, Urlaub..."
                    className="w-full px-3 py-2 text-sm rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-500 mb-1">
                    Art
                  </label>
                  <select
                    value={catType}
                    onChange={(e) =>
                      setCatType(e.target.value as "expense" | "income")
                    }
                    className="w-full px-3 py-2 text-sm rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950"
                  >
                    <option value="expense">Ausgabe</option>
                    <option value="income">Einnahme</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-500 mb-1">
                  Übergeordnete Hauptkategorie (Optional)
                </label>
                <select
                  value={catParentId || ""}
                  onChange={(e) => setCatParentId(e.target.value || null)}
                  className="w-full px-3 py-2 text-sm rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950"
                >
                  <option value="">Keine (Hauptkategorie)</option>
                  {categories
                    .filter((c) => c.type === catType && c.id !== catId && !c.parentId)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-500 mb-1.5">
                  Farbe
                </label>
                <div className="flex flex-wrap gap-2">
                  {CATEGORY_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setCatColor(color)}
                      className={cn(
                        "w-8 h-8 rounded-full transition",
                        catColor === color &&
                          "ring-2 ring-offset-2 ring-blue-600 scale-110"
                      )}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-500 mb-1.5">
                  Icon
                </label>
                <div className="grid grid-cols-7 sm:grid-cols-10 gap-2">
                  {AVAILABLE_ICON_NAMES.map((iconName) => (
                    <button
                      key={iconName}
                      type="button"
                      onClick={() => setCatIcon(iconName)}
                      className={cn(
                        "p-2 rounded-xl border flex items-center justify-center transition",
                        catIcon === iconName
                          ? "border-brand bg-brand text-white"
                          : "border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950"
                      )}
                    >
                      <CategoryIcon name={iconName} className="w-4 h-4" />
                    </button>
                  ))}
                </div>
              </div>

              <button
                type="submit"
                className="w-full py-2.5 rounded-xl bg-brand text-white hover:opacity-90 text-xs font-semibold flex items-center justify-center gap-1.5"
              >
                <Check className="w-4 h-4" />
                <span>Kategorie speichern</span>
              </button>
            </form>
          )}

          <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {categories.map((c) => (
              <div
                key={c.id}
                className="p-3.5 flex items-center justify-between gap-3"
              >
                <div className="flex items-center gap-3">
                  <div
                    className="w-9 h-9 rounded-full flex items-center justify-center bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 shrink-0"
                  >
                    <CategoryIcon name={c.icon} className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="font-semibold text-sm">{c.name}</p>
                    <p className="text-xs text-zinc-500">
                      {c.type === "income" ? "Einnahme" : "Ausgabe"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => openEditCategory(c)}
                    className="p-2 rounded-lg text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDeleteConfirm({
                        title: "Kategorie löschen",
                        message: `Möchtest du die Kategorie „${c.name}“ wirklich löschen bzw. archivieren? Zugehörige Ausgaben werden als „Sonstiges“ weitergeführt.`,
                        onConfirm: async () => {
                          const res = await deleteOrArchiveCategoryAction(c.id);
                          if (!res.success) {
                            toast.error(
                              res.error || "Fehler beim Löschen der Kategorie."
                            );
                          } else if (res.archived) {
                            toast.info(res.message);
                            setDeleteConfirm(null);
                          } else {
                            toast.success("Kategorie gelöscht.");
                            setDeleteConfirm(null);
                          }
                        },
                      });
                    }}
                    className="p-2 rounded-lg text-red-600 hover:bg-red-500/10 cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === "budgets" && (
        <div className="space-y-4">
          <div className="pb-4 border-b border-zinc-200/80 dark:border-zinc-800">
            <h1 className="text-base font-semibold">Monatsbudgets pro Kategorie</h1>
            <p className="text-xs text-zinc-500 mt-0.5">
              Lege ein monatliches Ausgabenlimit fest. Das Dashboard warnt
              automatisch bei 80 % (Gelb) und 100 % (Rot). Leer oder 0 entfernt
              das Budget.
            </p>
          </div>

          <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {/* Optionales Gesamt-Monatsbudget */}
            <div className="p-3.5 flex items-center justify-between gap-3 bg-zinc-50 dark:bg-zinc-800/40">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-brand text-white flex items-center justify-center text-white shrink-0">
                  <Wallet className="w-4 h-4" />
                </div>
                <div>
                  <p className="font-semibold text-sm">Gesamt-Monatsbudget</p>
                  <p className="text-xs text-zinc-500">
                    Über alle Kategorien hinweg
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  inputMode="decimal"
                  value={budgetInputs["GLOBAL"] || ""}
                  onChange={(e) =>
                    setBudgetInputs((prev) => ({
                      ...prev,
                      GLOBAL: e.target.value,
                    }))
                  }
                  placeholder="Kein Limit"
                  className="w-28 px-3 py-1.5 text-sm text-right rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950"
                />
                <button
                  type="button"
                  onClick={() => handleSaveSingleBudget("GLOBAL", null)}
                  className="px-3 py-1.5 rounded-xl bg-brand text-white text-xs font-semibold"
                >
                  Speichern
                </button>
              </div>
            </div>

            {categories
              .filter((c) => c.type === "expense")
              .map((c) => {
                const currentSaved = budgetMap[c.id];
                return (
                  <div
                    key={c.id}
                    className="p-3.5 flex items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className="w-9 h-9 rounded-full flex items-center justify-center bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 shrink-0"
                      >
                        <CategoryIcon name={c.icon} className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-sm truncate">
                          {c.name}
                        </p>
                        <p className="text-xs text-zinc-500">
                          {currentSaved
                            ? `Aktuell: ${formatCents(currentSaved)} / Monat`
                            : "Kein Monatslimit"}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <input
                        type="text"
                        inputMode="decimal"
                        value={budgetInputs[c.id] || ""}
                        onChange={(e) =>
                          setBudgetInputs((prev) => ({
                            ...prev,
                            [c.id]: e.target.value,
                          }))
                        }
                        placeholder="0,00 €"
                        className="w-28 px-3 py-1.5 text-sm text-right rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950"
                      />
                      <button
                        type="button"
                        onClick={() => handleSaveSingleBudget(c.id, c.id)}
                        className="px-3 py-1.5 rounded-xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-semibold"
                      >
                        Speichern
                      </button>
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* TAB: AUTO-KATEGORISIERUNGS-REGELN */}
      {activeTab === "rules" && (
        <div className="space-y-4">
          <div className="pb-4 border-b border-zinc-200/80 dark:border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h1 className="text-base font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                <span>Auto-Kategorisierungs-Regeln</span>
                <span className="text-xs px-2 py-0.5 rounded-md bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 font-semibold">
                  {rules.length}
                </span>
              </h1>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Ordnet Umsätze aus Bankabruf (PSD2) und CSV/PDF-Importen automatisch anhand von Händlern und Begriffen zu.
              </p>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {rules.length > 0 && (
                <button
                  type="button"
                  onClick={() => handleToggleAllRules(!rules.some((r) => r.isActive))}
                  className="px-3 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800 hover:bg-zinc-100 text-zinc-700 dark:text-zinc-300 text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
                  title={rules.some((r) => r.isActive) ? "Alle Regeln pausieren" : "Alle Regeln aktivieren"}
                >
                  <span>{rules.some((r) => r.isActive) ? "⏸️ Alle pausieren" : "▶️ Alle aktivieren"}</span>
                </button>
              )}

              <button
                type="button"
                onClick={handleSeedDefaultRules}
                disabled={isSeedingRules}
                className="px-3 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800 hover:bg-zinc-100 text-zinc-700 dark:text-zinc-300 text-xs font-semibold flex items-center gap-1.5 transition disabled:opacity-50 cursor-pointer"
                title="Lädt 25 erprobte Standard-Regeln (Supermärkte, Tanken, Abos, GEZ, etc.)"
              >
                {isSeedingRules ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <PackageCheck className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                )}
                <span>Standard-Regeln laden</span>
              </button>

              <button
                type="button"
                onClick={handleApplyRules}
                disabled={isApplyingRules || rules.length === 0}
                className="px-3 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 text-xs font-semibold flex items-center gap-1.5 transition disabled:opacity-50 cursor-pointer"
                title="Wendet alle aktiven Regeln rückwirkend auf bestehende Buchungen an"
              >
                {isApplyingRules ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Zap className="w-3.5 h-3.5" />
                )}
                <span>Regeln jetzt anwenden</span>
              </button>

              <button
                type="button"
                onClick={openNewRule}
                className="px-3 py-1.5 rounded-xl bg-brand text-white hover:opacity-90 text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>+ Neue Regel</span>
              </button>
            </div>
          </div>

          {rules.length === 0 ? (
            <div className="py-10 px-4 rounded-lg border border-dashed border-zinc-200 dark:border-zinc-800 text-center space-y-3">
              <div className="w-12 h-12 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 flex items-center justify-center mx-auto">
                <Zap className="w-6 h-6" />
              </div>
              <div>
                <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                  Noch keine automatischen Regeln angelegt
                </p>
                <p className="text-xs text-zinc-400 max-w-sm mx-auto mt-0.5">
                  Erstelle eigene Regeln oder aktiviere mit einem Klick das deutsche Standard-Regelpaket (REWE, Aldi, Shell, GEZ, Netflix etc.).
                </p>
              </div>
              <button
                type="button"
                onClick={handleSeedDefaultRules}
                disabled={isSeedingRules}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-brand text-white hover:opacity-90 text-xs font-bold transition cursor-pointer"
              >
                {isSeedingRules ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PackageCheck className="w-3.5 h-3.5" />}
                <span>25 Standard-Regeln aktivieren</span>
              </button>
            </div>
          ) : (
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800/80">
              {rules.map((rule) => {
                const targetCat = categories.find((c) => c.id === rule.categoryId);

                return (
                  <div
                    key={rule.id}
                    className={cn(
                      "py-3 flex items-center justify-between gap-3 hover:bg-zinc-50/50 dark:hover:bg-zinc-800/50 px-2 rounded-xl transition",
                      !rule.isActive && "opacity-55"
                    )}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 shrink-0"
                      >
                        <Zap className="w-4 h-4" />
                      </div>

                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-xs tabular-nums bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 rounded text-zinc-900 dark:text-zinc-100">
                            „{rule.pattern}“
                          </span>
                          <span className="text-xs text-zinc-400">→</span>
                          <span
                            className="text-xs font-semibold px-2 py-0.5 rounded-md text-white"
                            style={{ backgroundColor: targetCat?.color || "#3b82f6" }}
                          >
                            {targetCat?.name || "Kategorie"}
                          </span>
                          {rule.name && (
                            <span className="text-xs text-zinc-400">
                              ({rule.name})
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-zinc-400 mt-0.5">
                          Suchfeld:{" "}
                          {rule.matchField === "merchant"
                            ? "Nur Empfänger / Händler"
                            : rule.matchField === "remittance"
                              ? "Nur Verwendungszweck"
                              : "Empfänger & Verwendungszweck"}
                          {" • "}
                          Kostentyp: {rule.costType === "fixed" ? "Fixkosten" : "Variabel"}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleToggleRule(rule.id)}
                        className={cn(
                          "px-2 py-1 rounded-lg text-xs font-bold transition flex items-center gap-1 cursor-pointer",
                          rule.isActive
                            ? "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                            : "bg-zinc-200/70 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 hover:bg-zinc-300/70"
                        )}
                        title={rule.isActive ? "Regel pausieren / deaktivieren" : "Regel aktivieren"}
                      >
                        <span className={cn("w-1.5 h-1.5 rounded-full", rule.isActive ? "bg-emerald-500" : "bg-zinc-400")} />
                        <span>{rule.isActive ? "Aktiv" : "Pausiert"}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => openEditRule(rule)}
                        className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition cursor-pointer"
                        title="Regel bearbeiten"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteRule(rule.id)}
                        className="p-1.5 rounded-lg text-zinc-400 hover:text-red-500 transition cursor-pointer"
                        title="Regel löschen"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Formular Modal für Regel */}
          {showRuleForm && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 duration-150">
              <div className="w-full max-w-sm rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-5 shadow-lg space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-sm text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                    <Zap className="w-4 h-4 text-blue-600" />
                    <span>{ruleId ? "Regel bearbeiten" : "Neue Auto-Regel"}</span>
                  </h3>
                  <button
                    type="button"
                    onClick={() => setShowRuleForm(false)}
                    className="p-1 rounded-md text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <form onSubmit={handleSaveRule} className="space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                      Suchbegriff / Händler-Muster
                    </label>
                    <input
                      type="text"
                      required
                      value={rulePattern}
                      onChange={(e) => setRulePattern(e.target.value)}
                      placeholder="z. B. REWE, Lidl, Shell, Amazon, Gehalt"
                      className="w-full px-3 py-2 text-xs rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                      Regel-Name (Optional)
                    </label>
                    <input
                      type="text"
                      value={ruleName}
                      onChange={(e) => setRuleName(e.target.value)}
                      placeholder="z. B. Wocheneinkauf"
                      className="w-full px-3 py-2 text-xs rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                      Ziel-Kategorie
                    </label>
                    <select
                      value={ruleCatId}
                      onChange={(e) => setRuleCatId(e.target.value)}
                      className="w-full px-3 py-2 text-xs rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100"
                    >
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} ({c.type === "income" ? "Einnahme" : "Ausgabe"})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                        Suchfeld
                      </label>
                      <select
                        value={ruleMatchField}
                        onChange={(e) =>
                          setRuleMatchField(
                            e.target.value as
                              | "all"
                              | "merchant"
                              | "description"
                              | "remittance"
                          )
                        }
                        className="w-full px-2.5 py-2 text-xs rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100"
                      >
                        <option value="all">Überall</option>
                        <option value="merchant">Empfänger</option>
                        <option value="description">Beschreibung</option>
                        <option value="remittance">Zweck</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                        Kostentyp
                      </label>
                      <select
                        value={ruleCostType}
                        onChange={(e) =>
                          setRuleCostType(
                            e.target.value as "variable" | "fixed" | "transfer"
                          )
                        }
                        className="w-full px-2.5 py-2 text-xs rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100"
                      >
                        <option value="variable">Variabel</option>
                        <option value="fixed">Fixkosten</option>
                        <option value="transfer">Umbuchung</option>
                      </select>
                    </div>
                  </div>

                  <div className="pt-2 flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setShowRuleForm(false)}
                      className="px-3 py-1.5 rounded-xl text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                    >
                      Abbrechen
                    </button>
                    <button
                      type="submit"
                      className="px-4 py-2 rounded-xl bg-brand text-white hover:opacity-90 font-semibold text-xs transition"
                    >
                      Speichern
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      )}

      {/* App-eigener Bestätigungsdialog für Regeln, Kategorien & Vorlagen */}
      <ConfirmModal
        open={Boolean(deleteConfirm)}
        title={deleteConfirm?.title || "Löschen bestätigen"}
        message={deleteConfirm?.message || "Möchtest du dieses Element wirklich löschen?"}
        confirmText="Löschen"
        cancelText="Abbrechen"
        variant="danger"
        loading={isDeletingConfirm}
        onCancel={() => setDeleteConfirm(null)}
        onConfirm={async () => {
          if (!deleteConfirm) return;
          setIsDeletingConfirm(true);
          try {
            await deleteConfirm.onConfirm();
          } finally {
            setIsDeletingConfirm(false);
          }
        }}
      />
    </div>
  );
}
