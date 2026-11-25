import { db } from "./index";
import { categories, variablePresets } from "./schema";
import { eq } from "drizzle-orm";
import crypto from "node:crypto";

export interface DefaultCategoryDef {
  name: string;
  color: string;
  icon: string;
  type: "expense" | "income";
  sortOrder: number;
}

export const DEFAULT_CATEGORIES: DefaultCategoryDef[] = [
  {
    name: "Lebensmittel",
    color: "#10b981", // Emerald
    icon: "ShoppingCart",
    type: "expense",
    sortOrder: 1,
  },
  {
    name: "Restaurant & Café",
    color: "#f59e0b", // Amber
    icon: "Utensils",
    type: "expense",
    sortOrder: 2,
  },
  {
    name: "Mobilität & Tanken",
    color: "#3b82f6", // Blue
    icon: "Car",
    type: "expense",
    sortOrder: 3,
  },
  {
    name: "Wohnen & Miete",
    color: "#6366f1", // Indigo
    icon: "Home",
    type: "expense",
    sortOrder: 4,
  },
  {
    name: "Abos & Verträge",
    color: "#8b5cf6", // Violet
    icon: "Repeat",
    type: "expense",
    sortOrder: 5,
  },
  {
    name: "Shopping & Freizeit",
    color: "#ec4899", // Pink
    icon: "ShoppingBag",
    type: "expense",
    sortOrder: 6,
  },
  {
    name: "Gesundheit & Drogerie",
    color: "#14b8a6", // Teal
    icon: "HeartPulse",
    type: "expense",
    sortOrder: 7,
  },
  {
    name: "Versicherungen",
    color: "#64748b", // Slate
    icon: "ShieldCheck",
    type: "expense",
    sortOrder: 8,
  },
  {
    name: "Sonstiges",
    color: "#94a3b8", // Gray
    icon: "MoreHorizontal",
    type: "expense",
    sortOrder: 9,
  },
  {
    name: "Gehalt & Einnahmen",
    color: "#22c55e", // Green
    icon: "Wallet",
    type: "income",
    sortOrder: 10,
  },
  {
    name: "Umbuchung & Ausgleich",
    color: "#6366f1", // Indigo
    icon: "Repeat",
    type: "expense",
    sortOrder: 11,
  },
];

/**
 * Erstellt für einen neuen Benutzer automatisch die deutschen Standardkategorien
 * sowie nützliche vordefinierte variable Kosten-Vorlagen (Presets).
 */
export function ensureDefaultCategoriesForUser(userId: string) {
  const existing = db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.userId, userId))
    .limit(1)
    .all();

  if (existing.length > 0) {
    return;
  }

  const now = new Date();
  const createdByName: Record<string, string> = {};

  for (const cat of DEFAULT_CATEGORIES) {
    const id = crypto.randomUUID();
    createdByName[cat.name] = id;
    db.insert(categories)
      .values({
        id,
        userId,
        name: cat.name,
        color: cat.color,
        icon: cat.icon,
        type: cat.type,
        sortOrder: cat.sortOrder,
        isDefault: true,
        isArchived: false,
        createdAt: now,
      })
      .run();
  }

  // Standard-Vorlagen für variable Kosten anlegen (können angepasst oder gelöscht werden)
  const initialPresets = [
    {
      name: "Bäcker & Kaffee",
      catName: "Restaurant & Café",
      defaultAmountCents: 450,
      paymentMethod: "card" as const,
      sortOrder: 1,
    },
    {
      name: "Supermarkt Einkauf",
      catName: "Lebensmittel",
      defaultAmountCents: null,
      paymentMethod: "card" as const,
      sortOrder: 2,
    },
    {
      name: "Mittagessen",
      catName: "Restaurant & Café",
      defaultAmountCents: 1250,
      paymentMethod: "card" as const,
      sortOrder: 3,
    },
    {
      name: "Tanken",
      catName: "Mobilität & Tanken",
      defaultAmountCents: null,
      paymentMethod: "card" as const,
      sortOrder: 4,
    },
    {
      name: "Drogerie (dm / Rossmann)",
      catName: "Gesundheit & Drogerie",
      defaultAmountCents: null,
      paymentMethod: "card" as const,
      sortOrder: 5,
    },
  ];

  for (const preset of initialPresets) {
    const categoryId = createdByName[preset.catName];
    if (!categoryId) continue;

    db.insert(variablePresets)
      .values({
        id: crypto.randomUUID(),
        userId,
        categoryId,
        type: "expense",
        name: preset.name,
        defaultAmountCents: preset.defaultAmountCents,
        paymentMethod: preset.paymentMethod,
        usageCount: 0,
        sortOrder: preset.sortOrder,
        createdAt: now,
      })
      .run();
  }
}
