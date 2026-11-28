"use client";

import { useState } from "react";
import { useConfirm } from "@/components/ui/use-confirm";
import { useDialogA11y } from "@/lib/use-dialog-a11y";
import { formatCents, formatDateDE, parseEuroToCents } from "@/lib/format";
import {
  createSavingsGoalAction,
  adjustSavingsGoalAmountAction,
  updateSavingsGoalAction,
  deleteSavingsGoalAction,
} from "@/actions/savings-actions";
import {
  PiggyBank,
  Plus,
  Target,
  Calendar,
  Pencil,
  Trash2,
  ChevronRight,
  TrendingUp,
  X,
  Loader2,
  Check,
  Shield,
  Plane,
  Car,
  Home,
  Laptop,
  GraduationCap,
  Heart,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export interface SavingsGoalItem {
  id: string;
  name: string;
  targetAmountCents: number;
  currentAmountCents: number;
  targetDate: string | null;
  icon: string | null;
  color: string | null;
  isArchived: boolean;
  createdAt?: Date | string | null;
}

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  "piggy-bank": PiggyBank,
  shield: Shield,
  plane: Plane,
  car: Car,
  home: Home,
  laptop: Laptop,
  school: GraduationCap,
  heart: Heart,
  target: Target,
};

const COLOR_OPTIONS = [
  "#10b981", // Emerald
  "#2563eb", // Blue
  "#8b5cf6", // Purple
  "#f59e0b", // Amber
  "#ec4899", // Pink
  "#06b6d4", // Cyan
  "#f97316", // Orange
];

export function SavingsGoalsSection({
  goals = [],
}: {
  goals: SavingsGoalItem[];
}) {
  const { confirm, confirmDialog } = useConfirm();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingGoal, setEditingGoal] = useState<SavingsGoalItem | null>(null);
  const [adjustModalOpen, setAdjustModalOpen] = useState(false);
  const [selectedGoal, setSelectedGoal] = useState<SavingsGoalItem | null>(null);
  const [adjustMode, setAdjustMode] = useState<"deposit" | "withdraw">("deposit");
  const [adjustAmountStr, setAdjustAmountStr] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const goalDialog = useDialogA11y({ open: modalOpen, onClose: () => setModalOpen(false) });
  const adjustDialog = useDialogA11y({ open: adjustModalOpen, onClose: () => setAdjustModalOpen(false) });

  // Form State für Erstellen / Bearbeiten
  const [name, setName] = useState("");
  const [targetAmountStr, setTargetAmountStr] = useState("");
  const [currentAmountStr, setCurrentAmountStr] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [selectedIcon, setSelectedIcon] = useState("piggy-bank");
  const [selectedColor, setSelectedColor] = useState("#10b981");

  function openCreateModal() {
    setEditingGoal(null);
    setName("");
    setTargetAmountStr("");
    setCurrentAmountStr("");
    setTargetDate("");
    setSelectedIcon("piggy-bank");
    setSelectedColor("#10b981");
    setModalOpen(true);
  }

  function openEditModal(goal: SavingsGoalItem) {
    setEditingGoal(goal);
    setName(goal.name);
    setTargetAmountStr((goal.targetAmountCents / 100).toFixed(2).replace(".", ","));
    setCurrentAmountStr((goal.currentAmountCents / 100).toFixed(2).replace(".", ","));
    setTargetDate(goal.targetDate || "");
    setSelectedIcon(goal.icon || "piggy-bank");
    setSelectedColor(goal.color || "#10b981");
    setModalOpen(true);
  }

  function openAdjust(goal: SavingsGoalItem, mode: "deposit" | "withdraw") {
    setSelectedGoal(goal);
    setAdjustMode(mode);
    setAdjustAmountStr("");
    setAdjustModalOpen(true);
  }

  async function handleSaveGoal(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("Bitte einen Namen angeben.");
      return;
    }

    const targetCents = parseEuroToCents(targetAmountStr);
    if (!targetCents || targetCents <= 0) {
      toast.error("Bitte einen gültigen Zielbetrag eingeben.");
      return;
    }

    const currentCents = currentAmountStr ? parseEuroToCents(currentAmountStr) || 0 : 0;

    setIsSubmitting(true);
    try {
      if (editingGoal) {
        const res = await updateSavingsGoalAction({
          id: editingGoal.id,
          name: name.trim(),
          targetAmountCents: targetCents,
          currentAmountCents: currentCents,
          targetDate: targetDate || null,
          icon: selectedIcon,
          color: selectedColor,
        });
        if (res.success) {
          toast.success("Sparziel aktualisiert.");
          setModalOpen(false);
        } else {
          toast.error(res.error || "Fehler beim Speichern.");
        }
      } else {
        const res = await createSavingsGoalAction({
          name: name.trim(),
          targetAmountCents: targetCents,
          currentAmountCents: currentCents,
          targetDate: targetDate || null,
          icon: selectedIcon,
          color: selectedColor,
        });
        if (res.success) {
          toast.success("Sparziel angelegt.");
          setModalOpen(false);
        } else {
          toast.error(res.error || "Fehler beim Anlegen.");
        }
      }
    } catch {
      toast.error("Ein unerwarteter Fehler ist aufgetreten.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleAdjustSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedGoal) return;
    const amountCents = parseEuroToCents(adjustAmountStr);
    if (!amountCents || amountCents <= 0) {
      toast.error("Bitte einen gültigen Betrag eingeben.");
      return;
    }

    const deltaCents = adjustMode === "deposit" ? amountCents : -amountCents;
    setIsSubmitting(true);
    try {
      const res = await adjustSavingsGoalAmountAction({
        goalId: selectedGoal.id,
        deltaCents,
      });
      if (res.success) {
        toast.success(
          adjustMode === "deposit"
            ? `${formatCents(amountCents)} eingezahlt!`
            : `${formatCents(amountCents)} entnommen!`
        );
        setAdjustModalOpen(false);
      } else {
        toast.error(res.error || "Fehler bei der Anpassung.");
      }
    } catch {
      toast.error("Fehler beim Anpassen.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDeleteGoal(goal: SavingsGoalItem) {
    if (!(await confirm({ title: "Sparziel löschen?", confirmText: "Löschen", variant: "danger", message: `Sparziel „${goal.name}“ wirklich löschen?` }))) return;
    try {
      const res = await deleteSavingsGoalAction(goal.id);
      if (res.success) {
        toast.success("Sparziel gelöscht.");
      } else {
        toast.error(res.error || "Fehler beim Löschen.");
      }
    } catch {
      toast.error("Fehler beim Löschen.");
    }
  }

  const totalSavedCents = goals.reduce((sum, g) => sum + g.currentAmountCents, 0);
  const totalTargetCents = goals.reduce((sum, g) => sum + g.targetAmountCents, 0);
  const overallProgress =
    totalTargetCents > 0 ? Math.min(100, Math.round((totalSavedCents / totalTargetCents) * 100)) : 0;

  return (
    <section className="space-y-4">
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Sparziele</h2>
          {goals.length > 0 && (
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5 tabular-nums">
              {formatCents(totalSavedCents)} von {formatCents(totalTargetCents)} gespart
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={openCreateModal}
          className="text-xs font-medium text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 shrink-0 cursor-pointer"
        >
          Ziel anlegen
        </button>
      </div>

      {/* Sparziele Liste */}
      {goals.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400 py-2">
          Noch keine Sparziele – z. B. für Notgroschen, Jahresrechnungen oder Urlaub.
        </p>
      ) : (
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {goals.map((goal) => {
            const Icon = (goal.icon && ICON_MAP[goal.icon]) || PiggyBank;
            const progress =
              goal.targetAmountCents > 0
                ? Math.min(
                    100,
                    Math.round((goal.currentAmountCents / goal.targetAmountCents) * 100)
                  )
                : 0;
            const remainingCents = Math.max(0, goal.targetAmountCents - goal.currentAmountCents);

            // Sinking Fund monatliche Sparrate berechnen
            let monthlyRateStr: string | null = null;
            if (goal.targetDate && remainingCents > 0) {
              const targetD = new Date(goal.targetDate);
              const now = new Date();
              const monthsLeft =
                (targetD.getFullYear() - now.getFullYear()) * 12 +
                (targetD.getMonth() - now.getMonth());
              if (monthsLeft > 0) {
                const monthlyCents = Math.round(remainingCents / monthsLeft);
                monthlyRateStr = `${formatCents(monthlyCents)} / Monat`;
              }
            }

            // Plan-Status: Soll-Stand linear zwischen Anlage und Zieldatum
            let planLabel: string | null = null;
            if (goal.targetDate && goal.createdAt && remainingCents > 0) {
              const start = new Date(goal.createdAt).getTime();
              const end = new Date(goal.targetDate).getTime();
              const now = Date.now();
              if (end > start) {
                const share = Math.min(1, Math.max(0, (now - start) / (end - start)));
                const expectedCents = Math.round(goal.targetAmountCents * share);
                planLabel =
                  now > end
                    ? "Ziel überschritten"
                    : goal.currentAmountCents >= expectedCents
                      ? "Im Plan"
                      : `${formatCents(expectedCents - goal.currentAmountCents)} hinter dem Plan`;
              }
            } else if (remainingCents === 0 && goal.targetAmountCents > 0) {
              planLabel = "Ziel erreicht";
            }

            return (
              <li key={goal.id} className="py-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="w-8 h-8 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-zinc-500 dark:text-zinc-400 shrink-0">
                      <Icon className="w-4 h-4" aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                      <h3 className="text-sm text-zinc-900 dark:text-zinc-100 truncate">
                        {goal.name}
                      </h3>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        {goal.targetDate ? `bis ${formatDateDE(goal.targetDate)}` : "ohne Enddatum"}
                        {monthlyRateStr && ` · ${monthlyRateStr}`}
                        {planLabel && ` · ${planLabel}`}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => openEditModal(goal)}
                      className="p-1 rounded-md text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition"
                      title="Bearbeiten"
                      aria-label={`${goal.name} bearbeiten`}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteGoal(goal)}
                      className="p-1 rounded-md text-zinc-400 hover:text-red-500 transition"
                      title="Löschen"
                      aria-label={`${goal.name} löschen`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Beträge & Fortschrittsbalken */}
                <div className="space-y-1.5">
                  <div className="flex items-baseline justify-between text-sm tabular-nums">
                    <span className="font-medium text-zinc-900 dark:text-zinc-100">
                      {formatCents(goal.currentAmountCents)}
                    </span>
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">
                      von {formatCents(goal.targetAmountCents)} · {progress} %
                    </span>
                  </div>

                  <div className="w-full h-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-zinc-800 dark:bg-zinc-300"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>

                {/* Quick Einzahlen / Entnehmen Buttons */}
                <div className="flex items-center gap-4 text-xs">
                  <button
                    type="button"
                    onClick={() => openAdjust(goal, "deposit")}
                    className="font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 cursor-pointer"
                  >
                    Einzahlen
                  </button>
                  <button
                    type="button"
                    onClick={() => openAdjust(goal, "withdraw")}
                    className="font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 cursor-pointer"
                  >
                    Entnehmen
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Modal: Neues Sparziel / Sparziel bearbeiten */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 duration-150">
          <div {...goalDialog.dialogProps} className="w-full max-w-sm rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-5 shadow-lg space-y-4">
            <div className="flex items-center justify-between">
              <h3 id={goalDialog.titleId} className="font-bold text-sm text-zinc-900 dark:text-zinc-100">
                {editingGoal ? "Sparziel bearbeiten" : "Neues Sparziel anlegen"}
              </h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="p-1 rounded-md text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveGoal} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                  Name des Sparziels
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="z. B. Notgroschen, Sommerurlaub, Kfz-Steuer"
                  className="w-full px-3 py-2 text-xs rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                    Zielbetrag (€)
                  </label>
                  <input
                    type="text"
                    required
                    value={targetAmountStr}
                    onChange={(e) => setTargetAmountStr(e.target.value)}
                    placeholder="3.000,00"
                    className="w-full px-3 py-2 text-xs rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                    Bereits gespart (€)
                  </label>
                  <input
                    type="text"
                    value={currentAmountStr}
                    onChange={(e) => setCurrentAmountStr(e.target.value)}
                    placeholder="0,00"
                    className="w-full px-3 py-2 text-xs rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 tabular-nums"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                  Zieldatum (Optional für monatliche Sparrate)
                </label>
                <input
                  type="date"
                  value={targetDate}
                  onChange={(e) => setTargetDate(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100"
                />
              </div>

              {/* Farbwahl */}
              <div>
                <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1.5">
                  Farbe
                </label>
                <div className="flex items-center gap-2">
                  {COLOR_OPTIONS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setSelectedColor(c)}
                      className={cn(
                        "w-6 h-6 rounded-full transition flex items-center justify-center",
                        selectedColor === c && "ring-2 ring-offset-2 ring-zinc-400"
                      )}
                      style={{ backgroundColor: c }}
                    >
                      {selectedColor === c && <Check className="w-3.5 h-3.5 text-white" />}
                    </button>
                  ))}
                </div>
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-3 py-1.5 rounded-xl text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                >
                  Abbrechen
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 rounded-xl bg-brand text-white hover:opacity-90 font-semibold text-xs transition disabled:opacity-50 flex items-center gap-1.5"
                >
                  {isSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>{editingGoal ? "Aktualisieren" : "Anlegen"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Einzahlen / Entnehmen */}
      {adjustModalOpen && selectedGoal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 duration-150">
          <div {...adjustDialog.dialogProps} className="w-full max-w-xs rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-5 shadow-lg space-y-4">
            <div className="flex items-center justify-between">
              <h3 id={adjustDialog.titleId} className="font-bold text-sm text-zinc-900 dark:text-zinc-100">
                {adjustMode === "deposit" ? "Geld einzahlen" : "Geld entnehmen"}
              </h3>
              <button
                type="button"
                onClick={() => setAdjustModalOpen(false)}
                className="p-1 rounded-md text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {selectedGoal.name} • Aktuell: {formatCents(selectedGoal.currentAmountCents)}
            </p>

            <form onSubmit={handleAdjustSubmit} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                  Betrag (€)
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  value={adjustAmountStr}
                  onChange={(e) => setAdjustAmountStr(e.target.value)}
                  placeholder="50,00"
                  className="w-full px-3 py-2 text-sm rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 tabular-nums"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setAdjustModalOpen(false)}
                  className="px-3 py-1.5 rounded-xl text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                >
                  Abbrechen
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 rounded-xl bg-brand text-white hover:opacity-90 font-semibold text-xs transition disabled:opacity-50 flex items-center gap-1.5"
                >
                  {isSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>{adjustMode === "deposit" ? "Einzahlen" : "Entnehmen"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {confirmDialog}
    </section>
  );
}
