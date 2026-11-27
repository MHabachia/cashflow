"use server";

import { db } from "@/lib/db";
import {
  categoryRules,
  categories,
  transactions,
  type CategoryRule,
  MATCH_FIELDS,
} from "@/lib/db/schema";
import { requireUser } from "@/lib/session";
import { publicErrorMessage } from "@/lib/errors";
import { userOwnsCategory } from "@/lib/ownership";
import { and, eq, desc, asc } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import crypto from "node:crypto";
import { findMatchingRule } from "@/lib/category-rules";
import { DEFAULT_RULE_PRESETS } from "@/lib/default-rules";

function safeRevalidatePath(path: string) {
  try {
    revalidatePath(path);
  } catch {
    // Outside Next.js request context (z. B. Unit-Tests)
  }
}

const ruleSchema = z.object({
  id: z.string().optional(),
  name: z.string().max(100).optional().nullable(),
  pattern: z
    .string()
    .min(1, "Suchbegriff / Muster darf nicht leer sein.")
    .max(200),
  matchField: z.enum(MATCH_FIELDS).optional().default("all"),
  categoryId: z.string().min(1, "Bitte eine Ziel-Kategorie wählen."),
  costType: z.enum(["variable", "fixed", "transfer"]).optional().default("variable"),
  priority: z.number().int().optional().default(0),
  isActive: z.boolean().optional().default(true),
});

export type CategoryRuleInput = z.input<typeof ruleSchema>;

export async function getUserCategoryRulesAction() {
  const user = await requireUser();
  return db
    .select({
      id: categoryRules.id,
      name: categoryRules.name,
      pattern: categoryRules.pattern,
      matchField: categoryRules.matchField,
      categoryId: categoryRules.categoryId,
      categoryName: categories.name,
      categoryColor: categories.color,
      costType: categoryRules.costType,
      priority: categoryRules.priority,
      isActive: categoryRules.isActive,
      createdAt: categoryRules.createdAt,
    })
    .from(categoryRules)
    .innerJoin(
      categories,
      and(eq(categoryRules.categoryId, categories.id), eq(categories.userId, user.id))
    )
    .where(eq(categoryRules.userId, user.id))
    .orderBy(desc(categoryRules.priority), asc(categoryRules.pattern))
    .all();
}

export async function createCategoryRuleAction(
  input: z.input<typeof ruleSchema>
) {
  try {
    const user = await requireUser();
    const parsed = ruleSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues[0]?.message || "Ungültige Eingaben.",
      };
    }

    const data = parsed.data;
    if (!userOwnsCategory(user.id, data.categoryId)) {
      return { success: false, error: "Ungültige Kategorie." };
    }
    const id = crypto.randomUUID();
    const now = new Date();

    db.insert(categoryRules)
      .values({
        id,
        userId: user.id,
        name: data.name?.trim() || null,
        pattern: data.pattern.trim(),
        matchField: data.matchField,
        categoryId: data.categoryId,
        costType: data.costType,
        priority: data.priority,
        isActive: data.isActive,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    safeRevalidatePath("/categories");
    safeRevalidatePath("/transactions");
    return { success: true, id };
  } catch (err: unknown) {
    return {
      success: false,
      error: publicErrorMessage(err, "Regel konnte nicht erstellt werden.", "category-rule-actions"),
    };
  }
}

export async function updateCategoryRuleAction(
  input: z.input<typeof ruleSchema> & { id: string }
) {
  try {
    const user = await requireUser();
    const parsed = ruleSchema.safeParse(input);
    if (!parsed.success || !input.id) {
      return {
        success: false,
        error: parsed.error?.issues[0]?.message || "Ungültige Eingaben.",
      };
    }

    const data = parsed.data;
    const existing = db
      .select()
      .from(categoryRules)
      .where(
        and(eq(categoryRules.id, input.id), eq(categoryRules.userId, user.id))
      )
      .get();

    if (!existing) {
      return { success: false, error: "Regel nicht gefunden." };
    }
    if (data.categoryId !== undefined && !userOwnsCategory(user.id, data.categoryId)) {
      return { success: false, error: "Ungültige Kategorie." };
    }

    db.update(categoryRules)
      .set({
        name: data.name !== undefined ? data.name?.trim() || null : existing.name,
        pattern: data.pattern !== undefined ? data.pattern.trim() : existing.pattern,
        matchField: data.matchField !== undefined ? data.matchField : existing.matchField,
        categoryId: data.categoryId !== undefined ? data.categoryId : existing.categoryId,
        costType: data.costType !== undefined ? data.costType : existing.costType,
        priority: data.priority !== undefined ? data.priority : existing.priority,
        isActive: data.isActive !== undefined ? data.isActive : existing.isActive,
        updatedAt: new Date(),
      })
      .where(eq(categoryRules.id, existing.id))
      .run();

    safeRevalidatePath("/categories");
    safeRevalidatePath("/transactions");
    return { success: true };
  } catch (err: unknown) {
    return {
      success: false,
      error: publicErrorMessage(err, "Regel konnte nicht aktualisiert werden.", "category-rule-actions"),
    };
  }
}

export async function deleteCategoryRuleAction(id: string) {
  try {
    const user = await requireUser();
    db.delete(categoryRules)
      .where(and(eq(categoryRules.id, id), eq(categoryRules.userId, user.id)))
      .run();

    safeRevalidatePath("/categories");
    safeRevalidatePath("/transactions");
    safeRevalidatePath("/tools");
    return { success: true };
  } catch (err: unknown) {
    return {
      success: false,
      error: publicErrorMessage(err, "Regel konnte nicht gelöscht werden.", "category-rule-actions"),
    };
  }
}

export async function toggleCategoryRuleActiveAction(id: string) {
  try {
    const user = await requireUser();
    const existing = db
      .select({ id: categoryRules.id, isActive: categoryRules.isActive })
      .from(categoryRules)
      .where(and(eq(categoryRules.id, id), eq(categoryRules.userId, user.id)))
      .get();

    if (!existing) {
      return { success: false, error: "Regel nicht gefunden." };
    }

    db.update(categoryRules)
      .set({
        isActive: !existing.isActive,
        updatedAt: new Date(),
      })
      .where(eq(categoryRules.id, existing.id))
      .run();

    safeRevalidatePath("/categories");
    safeRevalidatePath("/tools");
    return { success: true, isActive: !existing.isActive };
  } catch (err: unknown) {
    return {
      success: false,
      error: publicErrorMessage(err, "Status konnte nicht geändert werden.", "category-rule-actions"),
    };
  }
}

export async function toggleAllCategoryRulesAction(active: boolean) {
  try {
    const user = await requireUser();
    db.update(categoryRules)
      .set({
        isActive: active,
        updatedAt: new Date(),
      })
      .where(eq(categoryRules.userId, user.id))
      .run();

    safeRevalidatePath("/categories");
    safeRevalidatePath("/tools");
    return { success: true };
  } catch (err: unknown) {
    return {
      success: false,
      error: publicErrorMessage(err, "Regeln konnten nicht umgeschaltet werden.", "category-rule-actions"),
    };
  }
}

export async function deleteAllCategoryRulesAction() {
  try {
    const user = await requireUser();
    db.delete(categoryRules)
      .where(eq(categoryRules.userId, user.id))
      .run();

    safeRevalidatePath("/categories");
    safeRevalidatePath("/tools");
    return { success: true };
  } catch (err: unknown) {
    return {
      success: false,
      error: publicErrorMessage(err, "Regeln konnten nicht gelöscht werden.", "category-rule-actions"),
    };
  }
}

/**
 * Richtet die deutschen Standard-Regeln für einen Benutzer ein.
 * Verknüpft automatisch die passenden Benutzerkategorien und überspringt bereits vorhandene Muster.
 */
export async function seedDefaultCategoryRulesAction(targetUserId?: string) {
  try {
    const user = await requireUser();
    const activeUserId = targetUserId && user.role === "admin" ? targetUserId : user.id;

    // 1. Kategorien des Nutzers laden
    const userCats = db
      .select({
        id: categories.id,
        name: categories.name,
      })
      .from(categories)
      .where(eq(categories.userId, activeUserId))
      .all();

    if (userCats.length === 0) {
      return { success: false, error: "Keine Kategorien vorhanden. Bitte zuerst Kategorien initialisieren." };
    }

    // 2. Bestehende Regeln laden (Dubletten-Schutz)
    const existingRules = db
      .select({
        pattern: categoryRules.pattern,
      })
      .from(categoryRules)
      .where(eq(categoryRules.userId, activeUserId))
      .all();

    const existingPatterns = new Set(existingRules.map((r) => r.pattern.toLowerCase().trim()));

    let createdCount = 0;
    const now = new Date();

    for (const preset of DEFAULT_RULE_PRESETS) {
      if (existingPatterns.has(preset.pattern.toLowerCase().trim())) {
        continue;
      }

      // Passende Kategorie über Name ermitteln
      const targetCategory =
        userCats.find((c) =>
          c.name.toLowerCase().includes(preset.categoryMatchName.toLowerCase())
        ) ||
        userCats.find((c) => /sonstig/i.test(c.name)) ||
        userCats[0];

      if (!targetCategory) continue;

      db.insert(categoryRules)
        .values({
          id: crypto.randomUUID(),
          userId: activeUserId,
          name: preset.name,
          pattern: preset.pattern,
          matchField: preset.matchField,
          categoryId: targetCategory.id,
          costType: preset.costType,
          priority: preset.priority,
          isActive: !preset.inactiveByDefault,
          createdAt: now,
          updatedAt: now,
        })
        .run();

      existingPatterns.add(preset.pattern.toLowerCase().trim());
      createdCount++;
    }

    safeRevalidatePath("/categories");
    safeRevalidatePath("/tools");
    safeRevalidatePath("/admin");

    return {
      success: true,
      createdCount,
      message: `${createdCount} Standard-Regeln erfolgreich aktiviert!`,
    };
  } catch (err: unknown) {
    return {
      success: false,
      error: publicErrorMessage(err, "Fehler beim Aktivieren der Standard-Regeln.", "category-rule-actions"),
    };
  }
}

export interface ApplyCategoryRulesOptions {
  overwriteExisting?: boolean; // Standard: false (bereits manuell kategorisierte Buchungen schützen)
}

/**
 * Wendet alle aktiven Regeln rückwirkend auf Transaktionen an.
 * Standardmäßig werden bereits manuell zugewiesene spezifische Kategorien geschützt und NICHT überschrieben.
 */
export async function applyCategoryRulesAction(options?: ApplyCategoryRulesOptions) {
  try {
    const user = await requireUser();
    const overwriteExisting = options?.overwriteExisting === true;

    // 1. Alle aktiven Regeln des Nutzers laden
    const rules = db
      .select()
      .from(categoryRules)
      .where(
        and(
          eq(categoryRules.userId, user.id),
          eq(categoryRules.isActive, true)
        )
      )
      .orderBy(desc(categoryRules.priority))
      .all();

    if (rules.length === 0) {
      return { success: true, matchedCount: 0, skippedCount: 0, totalChecked: 0, message: "Keine aktiven Regeln vorhanden." };
    }

    // 2. Kategorien laden zur Identifikation von Auffangkategorien ("Sonstiges", "Unkategorisiert")
    const allCats = db
      .select({ id: categories.id, name: categories.name })
      .from(categories)
      .where(eq(categories.userId, user.id))
      .all();
    const catMap = new Map(allCats.map((c) => [c.id, c.name.toLowerCase()]));

    // 3. Transaktionen des Nutzers laden
    const userTx = db
      .select({
        id: transactions.id,
        categoryId: transactions.categoryId,
        description: transactions.description,
        merchant: transactions.merchant,
      })
      .from(transactions)
      .where(eq(transactions.userId, user.id))
      .all();

    let matchedCount = 0;
    let skippedCount = 0;
    const now = new Date();

    db.transaction((tx) => {
      for (const t of userTx) {
        // Prüfen, ob die Buchung bereits eine spezifische, manuelle Kategorie hat
        const currentCatName = t.categoryId ? catMap.get(t.categoryId) || "" : "";
        const isUncategorizedOrGeneric =
          !t.categoryId ||
          currentCatName.includes("sonstig") ||
          currentCatName.includes("unkategori") ||
          currentCatName.includes("ohne kategorie");

        // Wenn kein Überschreiben erlaubt ist und der Eintrag bereits eine spezifische Kategorie hat: überspringen!
        if (!overwriteExisting && !isUncategorizedOrGeneric) {
          skippedCount++;
          continue;
        }

        const matching = findMatchingRule(
          {
            merchant: t.merchant,
            description: t.description,
          },
          rules
        );

        if (matching && matching.categoryId !== t.categoryId) {
          tx.update(transactions)
            .set({
              categoryId: matching.categoryId,
              costType: (matching.costType as "variable" | "fixed" | "transfer") || undefined,
              updatedAt: now,
            })
            .where(eq(transactions.id, t.id))
            .run();
          matchedCount++;
        }
      }
    });

    safeRevalidatePath("/");
    safeRevalidatePath("/transactions");
    safeRevalidatePath("/categories");
    safeRevalidatePath("/tools");

    const message = overwriteExisting
      ? `${matchedCount} von ${userTx.length} Buchungen neu kategorisiert.`
      : `${matchedCount} Buchungen neu kategorisiert (${skippedCount} bestehende Kategorien geschützt & unverändert).`;

    return {
      success: true,
      matchedCount,
      skippedCount,
      totalChecked: userTx.length,
      message,
    };
  } catch (err: unknown) {
    return {
      success: false,
      error: publicErrorMessage(err, "Fehler beim Anwenden der Regeln.", "category-rule-actions"),
    };
  }
}
