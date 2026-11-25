import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

const testDbPath = path.resolve("./data/test-transfer-detection.db");
process.env.DATABASE_PATH = testDbPath;

describe("Umbuchungs-Erkennung zwischen eigenen Konten (ersetzt Kleingeld Plus)", async () => {
  const userId = "transfer-user";
  let db: typeof import("../../src/lib/db/index").db;
  let s: typeof import("../../src/lib/db/schema");
  let eq: typeof import("drizzle-orm").eq;

  before(async () => {
    for (const suffix of ["", "-wal", "-shm"]) {
      if (fs.existsSync(testDbPath + suffix)) fs.unlinkSync(testDbPath + suffix);
    }
    const m = await import("../../src/lib/db/index");
    m.ensureDatabaseTables();
    db = m.db;
    s = await import("../../src/lib/db/schema");
    ({ eq } = await import("drizzle-orm"));
    const now = new Date();
    db.insert(s.user).values({ id: userId, name: "T", email: "transfer@kosten.local", createdAt: now, updatedAt: now }).run();
    db.insert(s.categories).values({ id: "t-misc", userId, name: "Sonstiges", type: "expense", createdAt: now }).run();
    db.insert(s.categories).values({ id: "t-inc", userId, name: "Einnahmen", type: "income", createdAt: now }).run();
    for (const [id, type] of [["t-giro", "checking"], ["t-save", "savings"]] as const) {
      db.insert(s.bankAccounts)
        .values({ id, userId, accountExternalId: id, accountName: id, accountType: type, currency: "EUR", balanceCents: 0, autoSync: false, createdAt: now, updatedAt: now })
        .run();
    }
  });

  it("paart gleiche Beträge zwischen verschiedenen Konten innerhalb von 3 Tagen", async () => {
    const { pairTransfers } = await import("../../src/lib/transfer-detection");
    const pairs = pairTransfers([
      { id: "out1", type: "expense", amountCents: 123, date: "2026-11-02", bankAccountId: "giro" },
      { id: "in1", type: "income", amountCents: 123, date: "2026-11-03", bankAccountId: "save" },
      { id: "out2", type: "expense", amountCents: 5000, date: "2026-11-02", bankAccountId: "giro" },
      { id: "in2-same-account", type: "income", amountCents: 5000, date: "2026-11-02", bankAccountId: "giro" },
      { id: "out3", type: "expense", amountCents: 700, date: "2026-11-01", bankAccountId: "giro" },
      { id: "in3-too-late", type: "income", amountCents: 700, date: "2026-11-09", bankAccountId: "save" },
    ]);
    assert.deepEqual(pairs, [["out1", "in1"]]);
  });

  it("markiert erkannte Paare als Umbuchung mit eigener Kategorie", async () => {
    const { detectOwnAccountTransfers } = await import("../../src/lib/transfer-detection");
    const now = new Date();
    db.insert(s.transactions)
      .values([
        { id: "kg-out", userId, categoryId: "t-misc", type: "expense", costType: "variable", amountCents: 37, date: "2026-11-20", description: "Kleingeld", bankAccountId: "t-giro", createdAt: now, updatedAt: now },
        { id: "kg-in", userId, categoryId: "t-inc", type: "income", costType: "variable", amountCents: 37, date: "2026-11-21", description: "Gutschrift", bankAccountId: "t-save", createdAt: now, updatedAt: now },
        { id: "real", userId, categoryId: "t-misc", type: "expense", costType: "variable", amountCents: 999, date: "2026-11-20", description: "Kauf", bankAccountId: "t-giro", createdAt: now, updatedAt: now },
      ])
      .run();
    assert.equal(detectOwnAccountTransfers(userId, "2026-11-01"), 1);
    const rows = db.select().from(s.transactions).all();
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    assert.equal(byId["kg-out"].costType, "transfer");
    assert.equal(byId["kg-in"].costType, "transfer");
    assert.equal(byId["real"].costType, "variable");
    const cat = db.select().from(s.categories).where(eq(s.categories.id, byId["kg-out"].categoryId)).get();
    assert.equal(cat?.name, "Umbuchung & Ausgleich");
    assert.equal(detectOwnAccountTransfers(userId, "2026-11-01"), 0, "idempotent");
  });

  it("Standardregel deckt Aufrundungssparen ohne geführtes Sparkonto ab", async () => {
    const { DEFAULT_RULE_PRESETS } = await import("../../src/lib/default-rules");
    const { matchesRule } = await import("../../src/lib/category-rules");
    const rule = DEFAULT_RULE_PRESETS.find((r) => r.name.startsWith("Kleingeld"))!;
    assert.equal(rule.costType, "transfer");
    assert.equal(matchesRule("ING Kleingeld Plus Sparen 0,37", rule), true);
    assert.equal(matchesRule("Kleingeldautomat Miete", rule), false);
  });

  it("Migration 8 legt für bisherige Kleingeld-Nutzer die Regel an", async () => {
    const { MIGRATIONS, runMigrations } = await import("../../src/lib/db/migrations");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cashflow-m8-"));
    const conn = new Database(path.join(dir, "m8.db"));
    try {
      runMigrations(conn, MIGRATIONS.filter((m) => m.id < 8));
      conn.exec(`INSERT INTO user (id, name, email, created_at, updated_at) VALUES ('a', 'A', 'a@x', 1, 1), ('b', 'B', 'b@x', 1, 1);
        INSERT INTO categories (id, user_id, name, type, created_at) VALUES ('ca', 'a', 'Umbuchung & Ausgleich', 'expense', 1), ('cb', 'b', 'Umbuchung & Ausgleich', 'expense', 1);
        INSERT INTO bank_accounts (id, user_id, account_external_id, account_name, account_type, currency, auto_sync, auto_roundup_transfer, created_at, updated_at)
          VALUES ('sa', 'a', 's', 'Tagesgeld', 'savings', 'EUR', 0, 1, 1, 1), ('sb', 'b', 's', 'Tagesgeld', 'savings', 'EUR', 0, 0, 1, 1);`);
      assert.deepEqual(runMigrations(conn, MIGRATIONS.filter((m) => m.id <= 8)), [8]);
      const rules = conn.prepare("SELECT user_id, cost_type FROM category_rules").all();
      assert.deepEqual(rules, [{ user_id: "a", cost_type: "transfer" }]);
      const flags = conn.prepare("SELECT SUM(auto_roundup_transfer) s FROM bank_accounts").get() as { s: number };
      assert.equal(flags.s, 0);
    } finally {
      conn.close();
    }
  });
});
