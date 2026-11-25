"use client";

import type { PaymentMethod } from "@/lib/db/schema";
import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  ListOrdered,
  Landmark,
  Plus,
  Repeat,
  Tag,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  QuickAddModal,
  type CategoryItem,
  type VariablePresetItem,
  type BankAccountItem,
} from "@/components/transactions/quick-add-modal";

export function BottomNav({
  categories,
  presets,
  bankAccounts,
  defaultPaymentMethod = "card",
}: {
  categories: CategoryItem[];
  presets: VariablePresetItem[];
  bankAccounts?: BankAccountItem[];
  defaultPaymentMethod?: PaymentMethod;
}) {
  const pathname = usePathname();
  const [quickOpen, setQuickOpen] = useState(false);

  // Ermöglicht anderen Komponenten, das Schnellerfassungs-Modal per CustomEvent zu öffnen
  useEffect(() => {
    const handler = () => setQuickOpen(true);
    window.addEventListener("open-quick-add", handler);
    return () => window.removeEventListener("open-quick-add", handler);
  }, []);

  const items = [
    { href: "/", label: "Übersicht", icon: LayoutDashboard },
    { href: "/transactions", label: "Umsätze", icon: ListOrdered },
    { href: "/banking", label: "Banking", icon: Landmark },
    { href: "/categories", label: "Kategorien", icon: Tag },
  ];

  return (
    <>
      <nav
        className={cn(
          "fixed bottom-0 inset-x-0 z-40 bg-white/95 dark:bg-zinc-900/95 backdrop-blur-lg border-t border-zinc-200 dark:border-zinc-800 pb-safe transition-all duration-200",
          "lg:hidden"
        )}
      >
        <div className="max-w-md mx-auto px-2 h-16 grid grid-cols-4 items-center">
          {items.map((item) => {
            const Icon = item.icon;
            const active =
              item.href === "/"
                ? pathname === "/"
                : item.href === "/transactions"
                ? pathname.startsWith("/transactions") ||
                  pathname.startsWith("/recurring")
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex flex-col items-center justify-center gap-1 text-xs font-medium transition py-1 rounded-xl",
                  active
                    ? "text-blue-600 dark:text-blue-400 font-semibold"
                    : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
                )}
              >
                <Icon className={cn("w-5 h-5", active && "stroke-[2.5]")} />
                <span className="truncate max-w-[70px] text-center leading-none text-xs">
                  {item.label}
                </span>
              </Link>
            );
          })}
        </div>
      </nav>

      {/* Schwebender „+“-Knopf für die Schnellerfassung */}
      <div
        className={cn(
          "fixed right-4 sm:right-6 md:right-8 z-40 transition-all duration-200",
          "bottom-20 lg:bottom-6"
        )}
      >
        <button
          type="button"
          onClick={() => setQuickOpen(true)}
          aria-label="Schnellerfassung öffnen"
          className="w-12 h-12 rounded-full bg-brand hover:opacity-90 text-white shadow-md flex items-center justify-center transition cursor-pointer"
        >
          <Plus className="w-5 h-5" aria-hidden="true" />
        </button>
      </div>

      <QuickAddModal
        open={quickOpen}
        onClose={() => setQuickOpen(false)}
        categories={categories}
        presets={presets}
        bankAccounts={bankAccounts}
        defaultPaymentMethod={defaultPaymentMethod}
      />
    </>
  );
}
