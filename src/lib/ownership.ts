import { and, eq, inArray } from "drizzle-orm";
import { db } from "./db";
import { categories } from "./db/schema";

/**
 * Eigentumsprüfungen für IDs, die der Client mitschickt. Fremdschlüssel prüfen
 * nur, ob ein Datensatz existiert, nicht wem er gehört. Ohne diese Prüfung
 * ließe sich eine fremde Kategorie verknüpfen und über Joins auslesen.
 */

export function userOwnsCategory(userId: string, categoryId: string): boolean {
  return !!db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.id, categoryId), eq(categories.userId, userId)))
    .get();
}

/** true, wenn alle (nicht leeren) Kategorie-IDs dem Benutzer gehören. */
export function userOwnsAllCategories(userId: string, categoryIds: string[]): boolean {
  const unique = [...new Set(categoryIds)];
  if (unique.length === 0) return true;
  const owned = db
    .select({ id: categories.id })
    .from(categories)
    .where(and(inArray(categories.id, unique), eq(categories.userId, userId)))
    .all();
  return owned.length === unique.length;
}

/** Obergrenze für den Weg nach oben; schützt vor Endlosschleifen bei Altdaten. */
const MAX_CATEGORY_DEPTH = 50;

/**
 * true, wenn `parentId` als Elternkategorie von `categoryId` einen Zyklus
 * erzeugen würde (A → B → A). Geprüft wird die Kette ab `parentId` nach oben.
 */
export function wouldCreateCategoryCycle(
  userId: string,
  categoryId: string,
  parentId: string
): boolean {
  let current: string | null = parentId;
  for (let depth = 0; current && depth < MAX_CATEGORY_DEPTH; depth++) {
    if (current === categoryId) return true;
    const row: { parentId: string | null } | undefined = db
      .select({ parentId: categories.parentId })
      .from(categories)
      .where(and(eq(categories.id, current), eq(categories.userId, userId)))
      .get();
    current = row?.parentId ?? null;
  }
  // Kette zu lang: als Zyklus behandeln, statt sie weiter zu verlängern
  return current !== null;
}
