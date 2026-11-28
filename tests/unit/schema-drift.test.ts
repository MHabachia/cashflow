import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const testDbPath = path.resolve("./data/test-schema-drift.db");
process.env.DATABASE_PATH = testDbPath;

/**
 * Schema (src/lib/db/schema.ts) und Migrationen (src/lib/db/migrations.ts)
 * müssen dieselbe Datenbank beschreiben. Sonst würden Werkzeuge, die vom
 * Schema ausgehen, Tabellen oder Indizes löschen, die nur die Migrationen anlegen.
 */

// Nur von den Migrationen verwaltet, bewusst nicht im Schema
const MIGRATION_ONLY_TABLES = new Set(["schema_migrations"]);

interface IndexShape {
  unique: boolean;
  columns: string[];
}

describe("Schema und Migrationen stimmen überein", async () => {
  let sqlite: import("better-sqlite3").Database;
  let schemaTables: Map<string, { columns: Set<string>; indexes: Map<string, IndexShape> }>;

  before(async () => {
    for (const suffix of ["", "-wal", "-shm"]) {
      if (fs.existsSync(testDbPath + suffix)) fs.unlinkSync(testDbPath + suffix);
    }
    const dbModule = await import("../../src/lib/db/index");
    dbModule.ensureDatabaseTables();
    const Database = (await import("better-sqlite3")).default;
    sqlite = new Database(testDbPath, { readonly: true });

    const { is } = await import("drizzle-orm");
    const { SQLiteTable, getTableConfig } = await import("drizzle-orm/sqlite-core");
    const schema = await import("../../src/lib/db/schema");

    schemaTables = new Map();
    for (const value of Object.values(schema)) {
      if (!is(value, SQLiteTable)) continue;
      const config = getTableConfig(value);
      const indexes = new Map<string, IndexShape>();
      for (const idx of config.indexes) {
        indexes.set(idx.config.name, {
          unique: idx.config.unique,
          columns: idx.config.columns.map((c) => ("name" in c ? c.name : String(c))),
        });
      }
      schemaTables.set(config.name, {
        columns: new Set(config.columns.map((c) => c.name)),
        indexes,
      });
    }
  });

  const dbTables = () =>
    (
      sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
        .all() as { name: string }[]
    )
      .map((r) => r.name)
      .filter((name) => !MIGRATION_ONLY_TABLES.has(name))
      .sort();

  it("enthält dieselben Tabellen", () => {
    assert.deepEqual(dbTables(), [...schemaTables.keys()].sort());
  });

  it("enthält dieselben Spalten je Tabelle", () => {
    for (const table of dbTables()) {
      const dbColumns = (sqlite.prepare(`SELECT name FROM pragma_table_info(?)`).all(table) as { name: string }[])
        .map((r) => r.name)
        .sort();
      assert.deepEqual(dbColumns, [...schemaTables.get(table)!.columns].sort(), `Spalten von ${table}`);
    }
  });

  it("enthält dieselben Indizes je Tabelle (Name, Eindeutigkeit, Spalten)", () => {
    for (const table of dbTables()) {
      // origin 'c' = per CREATE INDEX angelegt; automatische Indizes für
      // PRIMARY KEY / UNIQUE-Spalten entstehen aus den Spaltendefinitionen
      const dbIndexes = (
        sqlite.prepare(`SELECT name, "unique" AS isUnique FROM pragma_index_list(?) WHERE origin = 'c'`).all(table) as {
          name: string;
          isUnique: number;
        }[]
      ).map((idx) => [
        idx.name,
        {
          unique: idx.isUnique === 1,
          columns: (
            sqlite.prepare(`SELECT name FROM pragma_index_info(?) ORDER BY seqno`).all(idx.name) as { name: string }[]
          ).map((c) => c.name),
        },
      ] as const);

      const expected = Object.fromEntries([...schemaTables.get(table)!.indexes].sort(([a], [b]) => a.localeCompare(b)));
      const actual = Object.fromEntries([...dbIndexes].sort(([a], [b]) => a.localeCompare(b)));
      assert.deepEqual(actual, expected, `Indizes von ${table}`);
    }
  });
});
