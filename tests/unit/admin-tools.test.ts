import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { accentContrastIssue, contrastRatio } from "../../src/lib/color-contrast";
import { isNewerVersion } from "../../src/lib/update-check";
import { verifySqliteBackup } from "../../src/lib/backup-verify";

describe("Farbkontrast der Akzentfarbe", () => {
  it("berechnet bekannte Verhältnisse", () => {
    assert.equal(Math.round(contrastRatio("#000000", "#ffffff")! * 10) / 10, 21);
    assert.equal(contrastRatio("#ffffff", "#ffffff"), 1);
    assert.equal(contrastRatio("nope", "#ffffff"), null);
  });
  it("warnt bei hellen Akzentfarben, nicht beim Standardblau", () => {
    assert.equal(accentContrastIssue("#2563eb"), null);
    assert.match(accentContrastIssue("#facc15")!, /Zu hell/);
    assert.match(accentContrastIssue("#22c55e")!, /Knapp|Zu hell/);
  });
});

describe("Versionsvergleich", () => {
  it("erkennt neuere Versionen", () => {
    assert.equal(isNewerVersion("2.1.1", "2.1.0"), true);
    assert.equal(isNewerVersion("v3.0.0", "2.9.9"), true);
    assert.equal(isNewerVersion("2.1.0", "2.1.0"), false);
    assert.equal(isNewerVersion("2.0.9", "2.1.0"), false);
  });
});

describe("Backup-Prüfung", () => {
  function makeDb(withTables: boolean): Buffer {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bk-test-"));
    const file = path.join(dir, "b.db");
    const d = new Database(file);
    if (withTables) {
      d.exec('CREATE TABLE "user"(id text); CREATE TABLE transactions(id text); INSERT INTO "user" VALUES (\'a\');');
    } else {
      d.exec("CREATE TABLE other(id text);");
    }
    d.close();
    const buf = fs.readFileSync(file);
    fs.rmSync(dir, { recursive: true, force: true });
    return buf;
  }
  it("akzeptiert eine gültige Sicherung und zählt Zeilen", () => {
    const r = verifySqliteBackup(makeDb(true));
    assert.equal(r.ok, true);
    assert.equal(r.tables.user, 1);
  });
  it("meldet fehlende Kerntabellen", () => {
    const r = verifySqliteBackup(makeDb(false));
    assert.equal(r.ok, false);
    assert.match(r.error!, /Kerntabellen/);
  });
  it("meldet beschädigte Dateien", () => {
    const r = verifySqliteBackup(Buffer.from("das ist keine datenbank"));
    assert.equal(r.ok, false);
  });
});
