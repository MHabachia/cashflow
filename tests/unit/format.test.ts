import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatCents,
  centsToInput,
  parseEuroToCents,
  formatDateDE,
  escapeCsvField,
} from "../../src/lib/format";

describe("Währungs- & Datumsformatierung (src/lib/format.ts)", () => {
  it("formatiert Cent-Beträge korrekt ins deutsche Format (1.234,56 €)", () => {
    const formatted = formatCents(123456);
    assert.match(formatted, /1\.234,56\s*€/);

    const zero = formatCents(0);
    assert.match(zero, /0,00\s*€/);
  });

  it("konvertiert Cent-Beträge für Input-Felder mit Komma", () => {
    assert.equal(centsToInput(1250), "12,50");
    assert.equal(centsToInput(450), "4,50");
    assert.equal(centsToInput(null), "");
    assert.equal(centsToInput(undefined), "");
  });

  it("parst deutsche und internationale Euro-Eingaben sicher in Integer-Cent", () => {
    assert.equal(parseEuroToCents("12,50"), 1250);
    assert.equal(parseEuroToCents("1.234,56"), 123456);
    assert.equal(parseEuroToCents("12.50"), 1250);
    assert.equal(parseEuroToCents("4,5"), 450);
    assert.equal(parseEuroToCents("99 €"), 9900);
    assert.equal(parseEuroToCents(19.99), 1999);
  });

  it("erkennt Tausenderpunkte ohne Komma und englische Tausendertrenner", () => {
    assert.equal(parseEuroToCents("1.500"), 150000);
    assert.equal(parseEuroToCents("1.234.567"), 123456700);
    assert.equal(parseEuroToCents("1.234.567,89"), 123456789);
    assert.equal(parseEuroToCents("1,234.56"), 123456);
    // Ein Punkt mit ein oder zwei Nachkommastellen bleibt Dezimaltrenner
    assert.equal(parseEuroToCents("1.5"), 150);
    assert.equal(parseEuroToCents("150.00"), 15000);
    // Uneinheitliche Gruppen sind kein Tausenderformat
    assert.equal(parseEuroToCents("1.50.000"), null);
  });

  it("weist ungültige oder negative Beträge zurück", () => {
    assert.equal(parseEuroToCents(""), null);
    assert.equal(parseEuroToCents("abc"), null);
    assert.equal(parseEuroToCents("0"), null);
    assert.equal(parseEuroToCents("-10,00"), null);
  });

  it("formatiert ISO-Datum (YYYY-MM-DD) ins deutsche Format (DD.MM.YYYY)", () => {
    assert.equal(formatDateDE("2026-11-21"), "21.11.2026");
    assert.equal(formatDateDE("2026-01-05"), "05.01.2026");
    assert.equal(formatDateDE(""), "");
  });

  it("entschärft gefährliche CSV-Formula-Injection-Payloads (=, +, -, @)", () => {
    assert.equal(escapeCsvField("=CMD|' /C calc'!A0"), "'=CMD|' /C calc'!A0");
    assert.equal(escapeCsvField("+SUM(1,2)"), "'+SUM(1,2)");
    assert.equal(escapeCsvField("-10,00"), "'-10,00");
    assert.equal(escapeCsvField("@A1"), "'@A1");
    assert.equal(escapeCsvField("Normaler Einkauf"), "Normaler Einkauf");
  });
});
