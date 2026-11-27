import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const testDbPath = path.resolve("./data/test-security-low.db");
process.env.DATABASE_PATH = testDbPath;

const userId = "security-low-user";

describe("Fehlermeldungen an die Oberfläche", () => {
  it("gibt nur nutzergerichtete Meldungen weiter", async () => {
    const { publicErrorMessage, UserFacingError } = await import("../../src/lib/errors");
    const { BankApiError } = await import("../../src/lib/bank-sync/provider");
    const originalError = console.error;
    console.error = () => {};
    try {
      assert.equal(publicErrorMessage(new UserFacingError("Bitte Bank wählen."), "Fehler", "test"), "Bitte Bank wählen.");
      assert.equal(
        publicErrorMessage(new Error("SQLITE_CONSTRAINT: FOREIGN KEY constraint failed"), "Speichern fehlgeschlagen.", "test"),
        "Speichern fehlgeschlagen."
      );
      const bankError = new BankApiError("Enable Banking Session Fehler (401): {\"secret\":\"x\"}", 401);
      const bankMessage = publicErrorMessage(bankError, "Fehler", "test");
      assert.ok(!bankMessage.includes("secret"));
      assert.match(bankMessage, /neu verbinden/);
      const authError = Object.assign(new Error("Invalid password"), { name: "APIError" });
      assert.equal(publicErrorMessage(authError, "Fehler", "test"), "Invalid password");
    } finally {
      console.error = originalError;
    }
  });

  it("bank_error zeigt nur Meldungen zu festen Codes", async () => {
    const { bankErrorMessage, bankErrorCodeFor, BANK_ERROR_MESSAGES } = await import("../../src/lib/bank-error-codes");
    assert.equal(bankErrorMessage("csrf"), BANK_ERROR_MESSAGES.csrf);
    const spoofed = bankErrorMessage("Ihr Konto wurde gesperrt, bitte hier anmelden: evil.example");
    assert.ok(!spoofed.includes("evil.example"));
    assert.equal(bankErrorMessage("toString"), bankErrorMessage("unbekannt"));
    assert.equal(
      bankErrorCodeFor(new Error("Enable Banking API Fehler (400): Redirect URI nicht erlaubt (x)"), "auth_failed"),
      "redirect_uri_not_allowed"
    );
    assert.equal(bankErrorCodeFor(new Error("irgendwas"), "callback_failed"), "callback_failed");
  });
});

describe("CSV-Export", () => {
  it("entschärft Formeln auch nach Leerzeichen und Zeilenumbrüchen", async () => {
    const { escapeCsvField } = await import("../../src/lib/format");
    assert.equal(escapeCsvField("  =HYPERLINK(\"x\")"), "\"'  =HYPERLINK(\"\"x\"\")\"");
    assert.equal(escapeCsvField("\t=1+1"), "'\t=1+1");
    // Ein \r mitten im Text wird zu \n und das Feld in Anführungszeichen gesetzt
    assert.equal(escapeCsvField("Miete\r=1+1"), "\"Miete\n=1+1\"");
    // Steuerzeichen werden entfernt
    assert.equal(escapeCsvField("RE\u0000WE\u0007"), "REWE");
    assert.equal(escapeCsvField("Normaler Einkauf"), "Normaler Einkauf");
  });
});

describe("Doppelte Anfragen und frische Anmeldung", () => {
  before(async () => {
    for (const suffix of ["", "-wal", "-shm"]) {
      if (fs.existsSync(testDbPath + suffix)) fs.unlinkSync(testDbPath + suffix);
    }
    const { db, ensureDatabaseTables } = await import("../../src/lib/db/index");
    const { user } = await import("../../src/lib/db/schema");
    const { ensureDefaultCategoriesForUser } = await import("../../src/lib/db/defaults");
    ensureDatabaseTables();
    const now = new Date();
    db.insert(user).values({ id: userId, name: "Low", email: "low@kosten.local", createdAt: now, updatedAt: now }).run();
    ensureDefaultCategoriesForUser(userId);
    process.env.TEST_USER_ID = userId;
  });

  it("bucht eine Umbuchung mit demselben Einmal-Schlüssel nur einmal", async () => {
    const { createManualBankAccountAction, transferBetweenAccountsAction } = await import("../../src/actions/bank-actions");
    const { db } = await import("../../src/lib/db/index");
    const { bankAccounts } = await import("../../src/lib/db/schema");
    const { eq } = await import("drizzle-orm");

    const giro = await createManualBankAccountAction({ accountName: "Giro", accountType: "checking", balanceCents: 10_000 });
    const cash = await createManualBankAccountAction({ accountName: "Bar", accountType: "cash", balanceCents: 0 });
    assert.ok(giro.success && cash.success);
    const request = {
      sourceAccountId: giro.accountId!,
      targetAccountId: cash.accountId!,
      amountCents: 1_000,
      date: "2026-11-20",
      clientRequestId: "req-1",
    };
    assert.equal((await transferBetweenAccountsAction(request)).success, true);
    assert.equal((await transferBetweenAccountsAction(request)).success, true);

    const balance = (id: string) => db.select().from(bankAccounts).where(eq(bankAccounts.id, id)).get()?.balanceCents;
    assert.equal(balance(giro.accountId!), 9_000);
    assert.equal(balance(cash.accountId!), 1_000);

    // Neuer Schlüssel = neue Umbuchung
    assert.equal((await transferBetweenAccountsAction({ ...request, clientRequestId: "req-2" })).success, true);
    assert.equal(balance(giro.accountId!), 8_000);
  });

  it("verlangt ohne Passwort eine frische Anmeldung für Wiederherstellungscodes", async () => {
    const { generateRecoveryCodesAction } = await import("../../src/actions/password-recovery-actions");
    // Die Test-Sitzung hat kein Anlagedatum und gilt damit nicht als frisch
    const res = await generateRecoveryCodesAction({ currentPassword: "" });
    assert.equal(res.success, false);
  });
});
