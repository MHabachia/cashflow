import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import { db } from "../../src/lib/db";
import {
  user as userTable,
  categories,
  transactions,
} from "../../src/lib/db/schema";
import { getAnnualReportData } from "../../src/lib/reports";
import crypto from "node:crypto";

describe("Annual Financial Report Overview (Jahresrückblick & Steuer-Report)", () => {
  const testUserId = `report-tester-${crypto.randomUUID()}`;
  let catSalaryId: string;
  let catRentId: string;
  let catFoodId: string;

  beforeEach(() => {
    db.insert(userTable)
      .values({
        id: testUserId,
        name: "Report Tester",
        email: `${testUserId}@kosten.local`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoNothing()
      .run();

    catSalaryId = crypto.randomUUID();
    catRentId = crypto.randomUUID();
    catFoodId = crypto.randomUUID();

    db.insert(categories)
      .values([
        {
          id: catSalaryId,
          userId: testUserId,
          name: "Gehalt",
          type: "income",
          color: "#10b981",
          createdAt: new Date(),
        },
        {
          id: catRentId,
          userId: testUserId,
          name: "Wohnen & Miete",
          type: "expense",
          color: "#3b82f6",
          createdAt: new Date(),
        },
        {
          id: catFoodId,
          userId: testUserId,
          name: "Supermarkt",
          type: "expense",
          color: "#f59e0b",
          createdAt: new Date(),
        },
      ])
      .run();
  });

  it("aggregiert Einnahmen, Fixkosten, variable Ausgaben und Sparquote für das gewählte Jahr korrekt", () => {
    const year = 2026;

    // Januar 2026: 3.000 € Einnahme, 1.000 € Fixkosten, 500 € Variabel
    // Netto-Ersparnis: 1.500 € (Sparquote 50%)
    db.insert(transactions)
      .values([
        {
          id: crypto.randomUUID(),
          userId: testUserId,
          categoryId: catSalaryId,
          type: "income",
          costType: "variable",
          amountCents: 300000,
          date: `${year}-01-01`,
          description: "Gehalt Januar",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: crypto.randomUUID(),
          userId: testUserId,
          categoryId: catRentId,
          type: "expense",
          costType: "fixed",
          amountCents: 100000,
          date: `${year}-01-02`,
          description: "Miete Januar",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: crypto.randomUUID(),
          userId: testUserId,
          categoryId: catFoodId,
          type: "expense",
          costType: "variable",
          amountCents: 50000,
          date: `${year}-01-15`,
          description: "Einkauf Januar",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        // Buchung aus einem anderen Jahr (2025) darf das Jahr 2026 nicht beeinflussen
        {
          id: crypto.randomUUID(),
          userId: testUserId,
          categoryId: catSalaryId,
          type: "income",
          costType: "variable",
          amountCents: 999900,
          date: "2025-12-01",
          description: "Vorjahresgehalt",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ])
      .run();

    const report = getAnnualReportData(testUserId, year);

    assert.strictEqual(report.year, year);
    assert.strictEqual(report.totalIncomeCents, 300000);
    assert.strictEqual(report.totalFixedExpensesCents, 100000);
    assert.strictEqual(report.totalVariableExpensesCents, 50000);
    assert.strictEqual(report.totalExpensesCents, 150000);
    assert.strictEqual(report.netSavingsCents, 150000);
    assert.strictEqual(report.annualSavingsRatePercent, 50);

    // Monat 1 (Januar) prüfen
    const jan = report.monthlyBreakdown[0];
    assert.strictEqual(jan.month, 1);
    assert.strictEqual(jan.incomeCents, 300000);
    assert.strictEqual(jan.fixedExpensesCents, 100000);
    assert.strictEqual(jan.variableExpensesCents, 50000);
    assert.strictEqual(jan.savingsCents, 150000);
    assert.strictEqual(jan.savingsRatePercent, 50);

    // Kategorien-Ranking prüfen
    assert.strictEqual(report.topExpenseCategories.length, 2);
    assert.strictEqual(report.topExpenseCategories[0].name, "Wohnen & Miete");
    assert.strictEqual(report.topExpenseCategories[0].amountCents, 100000);
    assert.strictEqual(report.topExpenseCategories[1].name, "Supermarkt");
    assert.strictEqual(report.topExpenseCategories[1].amountCents, 50000);
  });
});
