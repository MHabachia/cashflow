import { requireUser } from "@/lib/session";
import { db } from "@/lib/db";
import {
  categories,
  variablePresets,
  budgets,
  categoryRules,
} from "@/lib/db/schema";
import { and, asc, desc, eq } from "drizzle-orm";
import { CategoriesAndPresetsView } from "@/components/categories/categories-presets-view";

export default async function CategoriesPage() {
  const user = await requireUser();

  const userCategories = db
    .select()
    .from(categories)
    .where(
      and(eq(categories.userId, user.id), eq(categories.isArchived, false))
    )
    .orderBy(asc(categories.sortOrder), asc(categories.name))
    .all();

  const userPresets = db
    .select()
    .from(variablePresets)
    .where(eq(variablePresets.userId, user.id))
    .orderBy(desc(variablePresets.usageCount), asc(variablePresets.sortOrder))
    .all();

  const userBudgets = db
    .select()
    .from(budgets)
    .where(eq(budgets.userId, user.id))
    .all();

  const userRules = db
    .select()
    .from(categoryRules)
    .where(eq(categoryRules.userId, user.id))
    .orderBy(desc(categoryRules.priority), asc(categoryRules.pattern))
    .all();

  return (
    <CategoriesAndPresetsView
      categories={userCategories.map((c) => ({
        id: c.id,
        name: c.name,
        color: c.color,
        icon: c.icon,
        type: c.type,
        parentId: c.parentId,
      }))}
      presets={userPresets.map((p) => ({
        id: p.id,
        name: p.name,
        categoryId: p.categoryId,
        type: p.type,
        defaultAmountCents: p.defaultAmountCents,
        paymentMethod: p.paymentMethod,
        usageCount: p.usageCount,
      }))}
      budgets={userBudgets.map((b) => ({
        id: b.id,
        categoryId: b.categoryId,
        amountCents: b.amountCents,
      }))}
      rules={userRules.map((r) => ({
        id: r.id,
        name: r.name,
        pattern: r.pattern,
        matchField: r.matchField,
        categoryId: r.categoryId,
        costType: r.costType,
        priority: r.priority,
        isActive: r.isActive,
      }))}
    />
  );
}
