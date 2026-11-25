import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  stageRestore,
  applyPendingRestore,
  hasPendingRestore,
} from "../../src/lib/db/restore";

function makeDb(file: string, extraSql = "") {
  const conn = new Database(file);
  conn.exec(`
    CREATE TABLE user (id TEXT PRIMARY KEY, marker TEXT);
    CREATE TABLE session (id TEXT PRIMARY KEY);
    CREATE TABLE account (id TEXT PRIMARY KEY);
    CREATE TABLE categories (id TEXT PRIMARY KEY);
    CREATE TABLE transactions (id TEXT PRIMARY KEY);
    ${extraSql}
  `);
  return conn;
}

describe("Sichere Datenbank-Wiederherstellung", () => {
  let dir: string;
  let livePath: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "cashflow-restore-"));
    livePath = path.join(dir, "app.db");
    const live = makeDb(livePath);
    live.pragma("journal_mode = WAL");
    live.prepare("INSERT INTO user VALUES ('u1', 'live')").run();
    live.close();
  });

  function backupBuffer(marker: string, extraSql = ""): Buffer {
    const file = path.join(dir, `src-${marker}.db`);
    const conn = makeDb(file, extraSql);
    conn.prepare("INSERT INTO user VALUES ('u1', ?)").run(marker);
    conn.close();
    return fs.readFileSync(file);
  }

  it("lehnt Dateien ohne SQLite-Header ab", () => {
    const res = stageRestore(Buffer.from("kein sqlite"), livePath);
    assert.equal(res.success, false);
    assert.equal(hasPendingRestore(livePath), false);
  });

  it("lehnt Sicherungen ohne Cashflow-Schema ab", () => {
    const file = path.join(dir, "fremd.db");
    const conn = new Database(file);
    conn.exec("CREATE TABLE foo (id INTEGER)");
    conn.close();
    const res = stageRestore(fs.readFileSync(file), livePath);
    assert.equal(res.success, false);
    assert.match(res.error || "", /fehlende Tabellen/);
  });

  it("lehnt Sicherungen mit Triggern ab", () => {
    const buf = backupBuffer(
      "trigger",
      "CREATE TRIGGER t AFTER INSERT ON transactions BEGIN DELETE FROM user; END;"
    );
    const res = stageRestore(buf, livePath);
    assert.equal(res.success, false);
    assert.match(res.error || "", /trigger/);
  });

  it("merkt gültige Sicherung vor, ohne die laufende DB anzufassen, und spielt sie beim Start ein", () => {
    const res = stageRestore(backupBuffer("restored"), livePath);
    assert.equal(res.success, true);
    assert.equal(hasPendingRestore(livePath), true);

    // Laufende DB unverändert
    let conn = new Database(livePath, { readonly: true });
    assert.equal((conn.prepare("SELECT marker FROM user").get() as { marker: string }).marker, "live");
    conn.close();

    assert.equal(applyPendingRestore(livePath), true);
    assert.equal(hasPendingRestore(livePath), false);

    conn = new Database(livePath, { readonly: true });
    assert.equal((conn.prepare("SELECT marker FROM user").get() as { marker: string }).marker, "restored");
    conn.close();

    const backups = fs.readdirSync(dir).filter((f) => f.startsWith("app.db.bak-"));
    assert.equal(backups.length, 1);
    const bak = new Database(path.join(dir, backups[0]), { readonly: true });
    assert.equal((bak.prepare("SELECT marker FROM user").get() as { marker: string }).marker, "live");
    bak.close();
  });
});
