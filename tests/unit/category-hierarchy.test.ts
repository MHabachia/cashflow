import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import { db } from "../../src/lib/db";
import { user as userTable, categories } from "../../src/lib/db/schema";
import {
  saveCategoryAction,
  deleteOrArchiveCategoryAction,
} from "../../src/actions/category-actions";
import { eq } from "drizzle-orm";
import crypto from "node:crypto";

describe("Category Hierarchy (Haupt- und Unterkategorien)", () => {
  const testUserId = `hierarchy-tester-${crypto.randomUUID()}`;

  beforeEach(() => {
    process.env.TEST_USER_ID = testUserId;

    db.insert(userTable)
      .values({
        id: testUserId,
        name: "Hierarchy Tester",
        email: `${testUserId}@kosten.local`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoNothing()
      .run();
  });

  it("erstellt eine Hauptkategorie und eine zugeordnete Unterkategorie", async () => {
    // 1. Hauptkategorie "Wohnen"
    const parentId = crypto.randomUUID();
    db.insert(categories)
      .values({
        id: parentId,
        userId: testUserId,
        name: "Wohnen",
        color: "#3b82f6",
        icon: "Home",
        type: "expense",
        parentId: null,
        createdAt: new Date(),
      })
      .run();

    // 2. Unterkategorie "Miete" via saveCategoryAction anlegen
    const subRes = await saveCategoryAction({
      name: "Miete",
      parentId: parentId,
      color: "#3b82f6",
      icon: "Home",
      type: "expense",
    });
    assert.strictEqual(subRes.success, true);

    // Aus DB abrufen
    const subCat = db
      .select()
      .from(categories)
      .where(eq(categories.userId, testUserId))
      .all()
      .find((c) => c.name === "Miete");

    assert.ok(subCat);
    assert.strictEqual(subCat.parentId, parentId);
  });

  it("verhindert zyklische Selbst-Zuweisung (Kategorie kann nicht ihr eigenes Parent sein)", async () => {
    const catId = crypto.randomUUID();
    db.insert(categories)
      .values({
        id: catId,
        userId: testUserId,
        name: "Auto",
        color: "#ef4444",
        icon: "Car",
        type: "expense",
        createdAt: new Date(),
      })
      .run();

    const res = await saveCategoryAction({
      id: catId,
      name: "Auto",
      parentId: catId, // Selbst-Referenz!
      color: "#ef4444",
      icon: "Car",
      type: "expense",
    });

    assert.strictEqual(res.success, false);
    assert.match(res.error || "", /nicht ihre eigene übergeordnete Kategorie/);
  });

  it("trennt Unterkategorien sauber ab, wenn die Hauptkategorie gelöscht wird", async () => {
    const parentId = crypto.randomUUID();
    const subId = crypto.randomUUID();

    db.insert(categories)
      .values([
        {
          id: parentId,
          userId: testUserId,
          name: "Freizeit",
          color: "#10b981",
          icon: "Smile",
          type: "expense",
          createdAt: new Date(),
        },
        {
          id: subId,
          userId: testUserId,
          name: "Kino",
          parentId: parentId,
          color: "#10b981",
          icon: "Film",
          type: "expense",
          createdAt: new Date(),
        },
      ])
      .run();

    const delRes = await deleteOrArchiveCategoryAction(parentId);
    assert.strictEqual(delRes.success, true);

    const subAfter = db
      .select()
      .from(categories)
      .where(eq(categories.id, subId))
      .get();
    assert.ok(subAfter);
    assert.strictEqual(subAfter.parentId, null);
  });
});
