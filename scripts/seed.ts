import { auth } from "../src/lib/auth";
import { runWithSignUpAllowed } from "../src/lib/signup-guard";
import { db } from "../src/lib/db";
import {
  user,
  categories,
  recurringExpenses,
  variablePresets,
  transactions,
  budgets,
  connectedBanks,
  bankAccounts,
} from "../src/lib/db/schema";
import { encryptBankToken } from "../src/lib/crypto/vault";
import { eq } from "drizzle-orm";
import crypto from "node:crypto";

async function runSeed() {
  // Das Seed legt ein Demo-Konto mit bekanntem Passwort an. In Produktion nie.
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEMO_SEED !== "true") {
    console.error(
      "Abbruch: Das Seed-Skript legt ein Demo-Konto mit bekanntem Passwort an und ist nur für die lokale Entwicklung gedacht."
    );
    process.exit(1);
  }

  console.log("Starte Seed-Skript mit Beispieldaten...");

  const demoEmail = "admin@kosten.local";
  const demoPassword = "AdminPassword123!";

  let existingUser = db
    .select()
    .from(user)
    .where(eq(user.email, demoEmail))
    .get();

  if (!existingUser) {
    console.log(`Erstelle Admin-Benutzer: ${demoEmail} / ${demoPassword}`);
    await runWithSignUpAllowed(() =>
      auth.api.signUpEmail({
        body: {
          name: "Max Mustermann",
          email: demoEmail,
          password: demoPassword,
        },
      })
    );
    existingUser = db
      .select()
      .from(user)
      .where(eq(user.email, demoEmail))
      .get();
  }

  if (!existingUser) {
    throw new Error("Admin-Benutzer konnte nicht angelegt werden.");
  }

  // Sicherstellen, dass der Seed-Admin garantiert die Administrator-Rolle besitzt
  db.update(user)
    .set({ role: "admin" })
    .where(eq(user.id, existingUser.id))
    .run();

  const userId = existingUser.id;
  const userCategories = db
    .select()
    .from(categories)
    .where(eq(categories.userId, userId))
    .all();

  const catMap = Object.fromEntries(userCategories.map((c) => [c.name, c.id]));

  // Prüfen ob schon Fixkosten vorhanden sind
  const existingFixed = db
    .select()
    .from(recurringExpenses)
    .where(eq(recurringExpenses.userId, userId))
    .all();

  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");

  if (existingFixed.length === 0) {
    console.log("Erstelle Beispiel-Fixkosten (monatlicher Abzug)...");
    const fixedItems = [
      {
        name: "Warmmiete Wohnung",
        cat: "Wohnen & Miete",
        amountCents: 95000,
        dayOfMonth: 1,
        paymentMethod: "transfer" as const,
      },
      {
        name: "Stromabschlag Stadtwerke",
        cat: "Wohnen & Miete",
        amountCents: 8500,
        dayOfMonth: 5,
        paymentMethod: "direct_debit" as const,
      },
      {
        name: "Glasfaser Internet & Mobilfunk",
        cat: "Abos & Verträge",
        amountCents: 5490,
        dayOfMonth: 10,
        paymentMethod: "direct_debit" as const,
      },
      {
        name: "Fitnessstudio Mitgliedschaft",
        cat: "Gesundheit & Drogerie",
        amountCents: 3990,
        dayOfMonth: 15,
        paymentMethod: "direct_debit" as const,
      },
      {
        name: "Streaming-Abo",
        cat: "Abos & Verträge",
        amountCents: 1399,
        dayOfMonth: 18,
        paymentMethod: "paypal" as const,
      },
      {
        name: "Haftpflicht & Hausrat",
        cat: "Versicherungen",
        amountCents: 2450,
        dayOfMonth: 1,
        paymentMethod: "direct_debit" as const,
      },
    ];

    const fixedIncomes = [
      {
        name: "Monatsgehalt Arbeitgeber",
        cat: "Gehalt & Einnahmen",
        amountCents: 325000,
        dayOfMonth: 1,
        paymentMethod: "transfer" as const,
      },
      {
        name: "Kindergeld Familienkasse",
        cat: "Gehalt & Einnahmen",
        amountCents: 25000,
        dayOfMonth: 5,
        paymentMethod: "transfer" as const,
      },
    ];

    for (const item of fixedIncomes) {
      const categoryId = catMap[item.cat] || userCategories[0].id;
      const dayStr = String(item.dayOfMonth).padStart(2, "0");
      const dueDate = `${year}-${month}-${dayStr}`;

      const recId = crypto.randomUUID();
      db.insert(recurringExpenses)
        .values({
          id: recId,
          userId,
          categoryId,
          type: "income",
          name: item.name,
          description: "Feste monatliche Einnahme",
          amountCents: item.amountCents,
          paymentMethod: item.paymentMethod,
          interval: "monthly",
          dayOfMonth: item.dayOfMonth,
          startDate: `${year}-01-${dayStr}`,
          nextDueDate: dueDate,
          lastProcessedDate: dueDate,
          autoBook: true,
          active: true,
          createdAt: now,
        })
        .run();
    }

    for (const item of fixedItems) {
      const categoryId = catMap[item.cat] || userCategories[0].id;
      const dayStr = String(item.dayOfMonth).padStart(2, "0");
      const dueDate = `${year}-${month}-${dayStr}`;

      const recId = crypto.randomUUID();
      db.insert(recurringExpenses)
        .values({
          id: recId,
          userId,
          categoryId,
          type: "expense",
          name: item.name,
          description: "Monatliche Fixkosten",
          amountCents: item.amountCents,
          paymentMethod: item.paymentMethod,
          interval: "monthly",
          dayOfMonth: item.dayOfMonth,
          startDate: `${year}-01-${dayStr}`,
          nextDueDate: dueDate,
          lastProcessedDate: dueDate,
          autoBook: true,
          active: true,
          createdAt: now,
        })
        .run();

      // Auch als gebuchte Fixkosten-Transaktion im aktuellen Monat anlegen
      db.insert(transactions)
        .values({
          id: crypto.randomUUID(),
          userId,
          categoryId,
          type: "expense",
          costType: "fixed",
          amountCents: item.amountCents,
          date: dueDate,
          description: item.name,
          paymentMethod: item.paymentMethod,
          recurringId: recId,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }
  }

  // Beispiel-Transaktionen (variable Kosten) anlegen
  const existingTx = db
    .select()
    .from(transactions)
    .where(eq(transactions.userId, userId))
    .all();

  if (existingTx.length <= 6) {
    console.log("Erstelle Beispiel-Einträge (Variable Kosten & Einnahmen)...");
    const sampleTx = [
      {
        cat: "Gehalt & Einnahmen",
        type: "income" as const,
        costType: "fixed" as const,
        amountCents: 325000,
        date: `${year}-${month}-01`,
        description: "Monatsgehalt",
        paymentMethod: "transfer" as const,
      },
      {
        cat: "Lebensmittel",
        type: "expense" as const,
        costType: "variable" as const,
        amountCents: 6845,
        date: `${year}-${month}-03`,
        description: "Wocheneinkauf Supermarkt",
        paymentMethod: "card" as const,
      },
      {
        cat: "Restaurant & Café",
        type: "expense" as const,
        costType: "variable" as const,
        amountCents: 480,
        date: `${year}-${month}-04`,
        description: "Bäcker & Kaffee",
        paymentMethod: "card" as const,
      },
      {
        cat: "Mobilität & Tanken",
        type: "expense" as const,
        costType: "variable" as const,
        amountCents: 7420,
        date: `${year}-${month}-06`,
        description: "Tanken Super E10",
        paymentMethod: "card" as const,
      },
      {
        cat: "Restaurant & Café",
        type: "expense" as const,
        costType: "variable" as const,
        amountCents: 3850,
        date: `${year}-${month}-08`,
        description: "Abendessen Pizzeria",
        paymentMethod: "card" as const,
      },
      {
        cat: "Lebensmittel",
        type: "expense" as const,
        costType: "variable" as const,
        amountCents: 5210,
        date: `${year}-${month}-11`,
        description: "Frischeinkauf & Getränke",
        paymentMethod: "card" as const,
      },
    ];

    for (const tx of sampleTx) {
      db.insert(transactions)
        .values({
          id: crypto.randomUUID(),
          userId,
          categoryId: catMap[tx.cat] || userCategories[0].id,
          type: tx.type,
          costType: tx.costType,
          amountCents: tx.amountCents,
          date: tx.date,
          description: tx.description,
          paymentMethod: tx.paymentMethod,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }
  }

  // Beispiel-Budgets anlegen
  const existingBudgets = db
    .select()
    .from(budgets)
    .where(eq(budgets.userId, userId))
    .all();

  if (existingBudgets.length === 0) {
    console.log("Erstelle Beispiel-Monatsbudgets...");
    const sampleBudgets = [
      { cat: "Lebensmittel", amountCents: 40000 },
      { cat: "Restaurant & Café", amountCents: 15000 },
      { cat: "Mobilität & Tanken", amountCents: 20000 },
      { cat: "Shopping & Freizeit", amountCents: 20000 },
    ];

    for (const b of sampleBudgets) {
      if (!catMap[b.cat]) continue;
      db.insert(budgets)
        .values({
          id: crypto.randomUUID(),
          userId,
          categoryId: catMap[b.cat],
          amountCents: b.amountCents,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }
  }

  // Beispiel-Bankverbindungen anlegen (ING & C24)
  const existingBanks = db
    .select()
    .from(connectedBanks)
    .where(eq(connectedBanks.userId, userId))
    .all();

  if (existingBanks.length === 0) {
    console.log("Erstelle Beispiel-Bankverbindungen (Open Banking)...");
    const expiresDate = new Date();
    expiresDate.setDate(now.getDate() + 89);
    const consentExpiresAt = expiresDate.toISOString().slice(0, 10);

    // 1. ING Deutschland
    const ingBankId = crypto.randomUUID();
    db.insert(connectedBanks)
      .values({
        id: ingBankId,
        userId,
        provider: "enable_banking",
        institutionId: "ING_DE",
        institutionName: "ING Deutschland",
        institutionLogo: "#ff6200",
        encryptedAccessToken: encryptBankToken("mock_ing_token_seed", userId),
        consentId: `consent_${crypto.randomUUID()}`,
        consentExpiresAt,
        lastSyncedAt: now.toISOString(),
        status: "active",
        createdAt: now,
        updatedAt: now,
      })
      .run();

    db.insert(bankAccounts)
      .values([
        {
          id: crypto.randomUUID(),
          connectedBankId: ingBankId,
          userId,
          accountExternalId: "seed_acc_ing_giro",
          ibanMasked: "DE** **** **** **** 4812",
          accountName: "ING Girokonto",
          accountType: "checking",
          currency: "EUR",
          balanceCents: 248050, // 2.480,50 €
          autoSync: true,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: crypto.randomUUID(),
          connectedBankId: ingBankId,
          userId,
          accountExternalId: "seed_acc_ing_visa",
          ibanMasked: "**** **** **** 8821",
          accountName: "ING VISA Card Debit",
          accountType: "credit_card",
          currency: "EUR",
          balanceCents: -12450, // -124,50 €
          autoSync: true,
          createdAt: now,
          updatedAt: now,
        },
      ])
      .run();

    // 2. C24 Bank
    const c24BankId = crypto.randomUUID();
    db.insert(connectedBanks)
      .values({
        id: c24BankId,
        userId,
        provider: "enable_banking",
        institutionId: "C24_DE",
        institutionName: "C24 Bank (CHECK24)",
        institutionLogo: "#0050aa",
        encryptedAccessToken: encryptBankToken("mock_c24_token_seed", userId),
        consentId: `consent_${crypto.randomUUID()}`,
        consentExpiresAt,
        lastSyncedAt: now.toISOString(),
        status: "active",
        createdAt: now,
        updatedAt: now,
      })
      .run();

    db.insert(bankAccounts)
      .values([
        {
          id: crypto.randomUUID(),
          connectedBankId: c24BankId,
          userId,
          accountExternalId: "seed_acc_c24_giro",
          ibanMasked: "DE** **** **** **** 9104",
          accountName: "C24 Smart Girokonto",
          accountType: "checking",
          currency: "EUR",
          balanceCents: 115020, // 1.150,20 €
          autoSync: true,
          createdAt: now,
          updatedAt: now,
        },
      ])
      .run();
  }

  // Beispiel-Bankumsätze für Prüf-Inbox und Abo-Erkennung (nur einmalig)
  const ingGiro = db
    .select({ id: bankAccounts.id })
    .from(bankAccounts)
    .where(eq(bankAccounts.accountExternalId, "seed_acc_ing_giro"))
    .get();
  const hasSeedBankTx = db
    .select({ id: transactions.id })
    .from(transactions)
    .where(eq(transactions.bankTransactionId, "seed_bank_tx_1"))
    .get();
  if (ingGiro && !hasSeedBankTx) {
    console.log("Erstelle Beispiel-Bankumsätze (Prüf-Inbox & Abo-Erkennung)...");
    const isoDaysAgo = (days: number) =>
      new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    const bankTx = [
      // Neue, noch ungeprüfte Umsätze aus dem Bank-Sync
      { cat: "Lebensmittel", amountCents: 3412, daysAgo: 1, merchant: "REWE Markt", pending: true },
      { cat: "Mobilität & Tanken", amountCents: 6150, daysAgo: 2, merchant: "Aral Tankstelle", pending: true },
      { cat: "Restaurant & Café", amountCents: 2390, daysAgo: 2, merchant: "Lieferando", pending: true },
      // Regelmäßige Abbuchung ohne Fixkosten-Vorlage → Abo-Vorschlag
      { cat: "Sonstiges", amountCents: 1099, daysAgo: 92, merchant: "Spotify AB", pending: false },
      { cat: "Sonstiges", amountCents: 1099, daysAgo: 61, merchant: "Spotify AB", pending: false },
      { cat: "Sonstiges", amountCents: 1199, daysAgo: 31, merchant: "Spotify AB", pending: false },
      { cat: "Sonstiges", amountCents: 1199, daysAgo: 1, merchant: "Spotify AB", pending: true },
    ];
    bankTx.forEach((tx, i) => {
      db.insert(transactions)
        .values({
          id: crypto.randomUUID(),
          userId,
          categoryId: catMap[tx.cat] || userCategories[0].id,
          type: "expense",
          costType: "variable",
          amountCents: tx.amountCents,
          date: isoDaysAgo(tx.daysAgo),
          description: tx.merchant,
          merchant: tx.merchant,
          paymentMethod: "card",
          bankAccountId: ingGiro.id,
          bankTransactionId: `seed_bank_tx_${i + 1}`,
          reviewStatus: tx.pending ? "pending" : null,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    });
  }

  console.log("Seed abgeschlossen! Login: admin@kosten.local / AdminPassword123!");
}

runSeed().catch((err) => {
  console.error("Seed fehlgeschlagen:", err);
  process.exit(1);
});
