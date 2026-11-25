"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "cashflow_getting_started_dismissed";

interface Step {
  label: string;
  href: string;
  done: boolean;
}

/**
 * Kurze Checkliste für neue Nutzer. Verschwindet, sobald alle drei Schritte
 * erledigt sind oder wenn sie ausgeblendet wird.
 */
export function GettingStarted({
  hasAccount,
  hasTransaction,
  hasBudget,
}: {
  hasAccount: boolean;
  hasTransaction: boolean;
  hasBudget: boolean;
}) {
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(STORAGE_KEY) === "1");
    } catch {
      setDismissed(false);
    }
  }, []);

  const steps: Step[] = [
    { label: "Konto verbinden oder anlegen", href: "/banking", done: hasAccount },
    { label: "Erste Buchung erfassen", href: "/transactions?quickAdd=1", done: hasTransaction },
    { label: "Erstes Budget setzen", href: "/categories?tab=budgets", done: hasBudget },
  ];
  const doneCount = steps.filter((s) => s.done).length;

  if (dismissed || doneCount === steps.length) return null;

  return (
    <section aria-label="Erste Schritte" className="border-b border-zinc-200 dark:border-zinc-800 pb-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Erste Schritte <span className="font-normal text-zinc-500">· {doneCount} von {steps.length}</span>
        </h2>
        <button
          type="button"
          onClick={() => {
            try {
              localStorage.setItem(STORAGE_KEY, "1");
            } catch {
              /* ignorieren */
            }
            setDismissed(true);
          }}
          className="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          Ausblenden
        </button>
      </div>
      <ul className="mt-3 space-y-1">
        {steps.map((step) => (
          <li key={step.href}>
            <Link
              href={step.href}
              className={cn(
                "flex items-center gap-3 py-2 text-sm min-h-11",
                step.done ? "text-zinc-400 line-through" : "text-zinc-800 dark:text-zinc-200 hover:underline"
              )}
            >
              <span
                className={cn(
                  "w-5 h-5 rounded-full border flex items-center justify-center shrink-0",
                  step.done ? "bg-brand border-brand text-white" : "border-zinc-300 dark:border-zinc-600"
                )}
                aria-hidden="true"
              >
                {step.done && <Check className="w-3 h-3" />}
              </span>
              {step.label}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
