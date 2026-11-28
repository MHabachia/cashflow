import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const testDbPath = path.resolve("./data/test-offline-queue.db");
process.env.DATABASE_PATH = testDbPath;

import {
  createClientTempId,
  pendingItems,
  rejectedItems,
  toTransactionInput,
  withRejection,
  withRetry,
  without,
  type QueuedOfflineTransaction,
} from "../../src/lib/offline-queue-state";

function item(id: string, extra: Partial<QueuedOfflineTransaction> = {}): QueuedOfflineTransaction {
  return {
    clientTempId: id,
    queuedAt: "2026-11-28T10:00:00.000Z",
    categoryId: "cat",
    type: "expense",
    amountCents: 500,
    date: "2026-11-28",
    description: id,
    ...extra,
  };
}

describe("Offline-Queue: Zustand", () => {
  it("abgelehnte Einträge bleiben erhalten, werden aber nicht erneut gesendet", () => {
    const queue = withRejection([item("a"), item("b")], "a", "Ungültige Kategorie.", new Date("2026-11-28T11:00:00Z"));
    assert.equal(queue.length, 2);
    assert.deepEqual(pendingItems(queue).map((i) => i.clientTempId), ["b"]);
    assert.deepEqual(rejectedItems(queue).map((i) => i.clientTempId), ["a"]);
    assert.equal(queue[0].rejectionReason, "Ungültige Kategorie.");
    assert.equal(queue[0].rejectedAt, "2026-11-28T11:00:00.000Z");
  });

  it("Erneut senden hebt die Ablehnung auf und behält die ID", () => {
    const queue = withRetry(withRejection([item("a")], "a", "Fehler"), "a");
    assert.deepEqual(pendingItems(queue).map((i) => i.clientTempId), ["a"]);
    assert.equal("rejectedAt" in queue[0], false);
    assert.equal("rejectionReason" in queue[0], false);
  });

  it("Verwerfen entfernt nur den gewählten Eintrag", () => {
    assert.deepEqual(without([item("a"), item("b")], "a").map((i) => i.clientTempId), ["b"]);
  });

  it("sendet keine Queue-Metadaten an den Server", () => {
    const input = toTransactionInput(withRejection([item("a")], "a", "Fehler")[0]);
    assert.equal(input.clientTempId, "a");
    for (const key of ["queuedAt", "rejectedAt", "rejectionReason"]) {
      assert.equal(key in input, false, key);
    }
  });

  it("erzeugt eindeutige IDs, auch ohne crypto.randomUUID (http:// im Heimnetz)", () => {
    const a = createClientTempId();
    assert.notEqual(a, createClientTempId());

    // Eigene Eigenschaft überdeckt die Methode am Prototyp; delete stellt sie wieder her
    Object.defineProperty(crypto, "randomUUID", { value: undefined, configurable: true });
    try {
      const fallback = createClientTempId();
      assert.match(fallback, /^[0-9a-f]{32}$/);
      assert.notEqual(fallback, createClientTempId());
    } finally {
      delete (crypto as { randomUUID?: unknown }).randomUUID;
      assert.equal(typeof crypto.randomUUID, "function", "Original wiederhergestellt");
    }
  });
});

describe("Offline-Queue: Deduplizierung auf dem Server", async () => {
  const userId = "offline-queue-user";

  before(async () => {
    for (const suffix of ["", "-wal", "-shm"]) {
      if (fs.existsSync(testDbPath + suffix)) fs.unlinkSync(testDbPath + suffix);
    }
    const m = await import("../../src/lib/db/index");
    m.ensureDatabaseTables();
    const s = await import("../../src/lib/db/schema");
    process.env.TEST_USER_ID = userId;
    const now = new Date();
    m.db.insert(s.user).values({ id: userId, name: "O", email: "offline@kosten.local", createdAt: now, updatedAt: now }).run();
    m.db.insert(s.categories).values({ id: "oq-food", userId, name: "Lebensmittel", type: "expense", createdAt: now }).run();
  });

  it("zweites Senden mit derselben clientTempId legt keine zweite Buchung an", async () => {
    const { createTransactionAction } = await import("../../src/actions/transaction-actions");
    const { db } = await import("../../src/lib/db/index");
    const { transactions } = await import("../../src/lib/db/schema");
    const { eq } = await import("drizzle-orm");

    const payload = { categoryId: "oq-food", type: "expense" as const, amountCents: 1250, date: "2026-11-28", description: "Bäcker", paymentMethod: "card" as const, clientTempId: createClientTempId() };
    const first = await createTransactionAction(payload);
    // Antwort ging verloren, die Buchung kommt aus der Offline-Queue erneut
    const second = await createTransactionAction(payload);

    assert.equal(first.success, true);
    assert.equal(second.success, true);
    assert.equal(second.deduplicated, true);
    assert.equal(second.id, first.id);
    assert.equal(db.select().from(transactions).where(eq(transactions.userId, userId)).all().length, 1);
  });
});
