import Link from "next/link";
import type { ReactNode } from "react";
import { formatCents } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Ruhige Grundbausteine für Finanzansichten.
 *
 * Gestaltungsregeln:
 * - Beträge in der normalen Schrift mit gleich breiten Ziffern (tabular-nums),
 *   keine Monospace-Schrift, kein font-black.
 * - Farbe nur mit Bedeutung: Grün für Zuflüsse, Rot für Überschreitungen,
 *   sonst neutrale Grautöne. Eine Akzentfarbe (blau) für Links und Aktionen.
 * - Feste Schriftgrößen: text-xs (Nebeninfo), text-sm (Text), text-base/xl/3xl (Zahlen).
 */

type AmountSize = "sm" | "md" | "lg" | "xl";

const AMOUNT_SIZE: Record<AmountSize, string> = {
  sm: "text-sm",
  md: "text-base",
  lg: "text-xl",
  xl: "text-4xl sm:text-5xl tracking-tight",
};

export function Amount({
  cents,
  size = "sm",
  signed = false,
  tone = "auto",
  className,
}: {
  cents: number;
  size?: AmountSize;
  /** Vorzeichen immer anzeigen (+/−) */
  signed?: boolean;
  /** auto: positiv grün nur bei signed, sonst neutral */
  tone?: "auto" | "neutral" | "positive" | "negative";
  className?: string;
}) {
  const sign = cents > 0 ? "+" : cents < 0 ? "−" : "";
  const color =
    tone === "positive"
      ? "text-emerald-700 dark:text-emerald-400"
      : tone === "negative"
        ? "text-red-600 dark:text-red-400"
        : tone === "neutral"
          ? "text-zinc-900 dark:text-zinc-100"
          : signed && cents > 0
            ? "text-emerald-700 dark:text-emerald-400"
            : "text-zinc-900 dark:text-zinc-100";
  return (
    <span
      className={cn(
        "tabular-nums whitespace-nowrap",
        size === "xl" ? "font-semibold" : "font-medium",
        AMOUNT_SIZE[size],
        color,
        className
      )}
    >
      {signed ? sign : cents < 0 ? "−" : ""}
      {formatCents(Math.abs(cents))}
    </span>
  );
}

export function Section({
  title,
  description,
  action,
  children,
  className,
}: {
  title: string;
  description?: ReactNode;
  action?: { href: string; label: string };
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("space-y-3", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</h2>
          {description && (
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">{description}</p>
          )}
        </div>
        {action && (
          <Link
            href={action.href}
            className="text-xs font-medium text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 shrink-0"
          >
            {action.label}
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

/** Schlichter Fortschrittsbalken; Farbe nur bei Warnung/Überschreitung. */
export function Meter({
  percent,
  status = "normal",
  label,
}: {
  percent: number;
  status?: "normal" | "warning" | "exceeded";
  label?: string;
}) {
  return (
    <div
      className="h-1.5 w-full rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden"
      role="progressbar"
      aria-valuenow={Math.round(percent)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <div
        className={cn(
          "h-full rounded-full",
          status === "exceeded"
            ? "bg-red-500"
            : status === "warning"
              ? "bg-amber-500"
              : "bg-brand"
        )}
        style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
      />
    </div>
  );
}

export function EmptyHint({
  children,
  action,
}: {
  children: ReactNode;
  action?: { href: string; label: string };
}) {
  return (
    <div className="py-2 space-y-2">
      <p className="text-sm text-zinc-500 dark:text-zinc-400">{children}</p>
      {action && (
        <Link
          href={action.href}
          className="inline-flex items-center px-3 py-1.5 rounded-lg bg-brand text-white text-xs font-semibold hover:opacity-90 transition"
        >
          {action.label}
        </Link>
      )}
    </div>
  );
}
