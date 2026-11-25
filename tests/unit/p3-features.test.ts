import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

const testDbPath = path.resolve("./data/test-p3-features.db");
process.env.DATABASE_PATH = testDbPath;

describe("P3: Push, Abo-Erkennung, CAMT, Backups, Prognose, Inbox, Benachrichtigungen", async () => {
  const userId = "p3-user";
  let db: typeof import("../../src/lib/db/index").db;
  let schema: typeof import("../../src/lib/db/schema");

  before(async () => {
    for (const suffix of ["", "-wal", "-shm"]) {
      if (fs.existsSync(testDbPath + suffix)) fs.unlinkSync(testDbPath + suffix);
    }
    const dbModule = await import("../../src/lib/db/index");
    dbModule.ensureDatabaseTables();
    db = dbModule.db;
    schema = await import("../../src/lib/db/schema");
    process.env.TEST_USER_ID = userId;
    const now = new Date();
    db.insert(schema.user)
      .values({ id: userId, name: "P3", email: "p3@kosten.local", createdAt: now, updatedAt: now })
      .run();
    db.insert(schema.categories)
      .values([
        { id: "p3-cat-abo", userId, name: "Abos", type: "expense", createdAt: now },
        { id: "p3-cat-food", userId, name: "Lebensmittel", type: "expense", createdAt: now },
      ])
      .run();
  });

  // ---------------- Web Push ----------------
  it("verschlüsselt Push-Nutzlasten nach RFC 8291 (Rundlauf wie im Browser)", async () => {
    const { encryptPushPayload } = await import("../../src/lib/push/web-push");
    const ua = crypto.createECDH("prime256v1");
    ua.generateKeys();
    const auth = crypto.randomBytes(16);
    const message = Buffer.from(JSON.stringify({ title: "Hallo", body: "Ä Ö Ü €" }));

    const body = encryptPushPayload(
      { endpoint: "https://fcm.googleapis.com/x", p256dh: ua.getPublicKey().toString("base64url"), auth: auth.toString("base64url") },
      message
    );

    // Empfängerseite (Browser): Header lesen und entschlüsseln
    const salt = body.subarray(0, 16);
    assert.equal(body.readUInt32BE(16), 4096);
    const idLen = body[20];
    const asPublic = body.subarray(21, 21 + idLen);
    const ciphertext = body.subarray(21 + idLen);
    const shared = ua.computeSecret(asPublic);
    const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), ua.getPublicKey(), asPublic]);
    const ikm = Buffer.from(crypto.hkdfSync("sha256", shared, auth, keyInfo, 32));
    const cek = Buffer.from(crypto.hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
    const nonce = Buffer.from(crypto.hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
    const decipher = crypto.createDecipheriv("aes-128-gcm", cek, nonce);
    decipher.setAuthTag(ciphertext.subarray(ciphertext.length - 16));
    const plain = Buffer.concat([decipher.update(ciphertext.subarray(0, ciphertext.length - 16)), decipher.final()]);
    assert.equal(plain[plain.length - 1], 0x02);
    assert.deepEqual(plain.subarray(0, plain.length - 1), message);
  });

  it("signiert VAPID-JWTs prüfbar und lässt nur bekannte Push-Dienste zu", async () => {
    const { generateVapidKeys, getVapidKeys, createVapidJwt, isAllowedPushEndpoint, resetVapidKeyCache } =
      await import("../../src/lib/push/web-push");
    const generated = generateVapidKeys();
    process.env.VAPID_PUBLIC_KEY = generated.publicKey;
    process.env.VAPID_PRIVATE_KEY = generated.privateKey;
    resetVapidKeyCache();
    const keys = getVapidKeys();
    const jwt = createVapidJwt("https://fcm.googleapis.com", "mailto:test@example.local", keys);
    const [h, p, sig] = jwt.split(".");
    const raw = Buffer.from(keys.publicKey, "base64url");
    const pub = crypto.createPublicKey({
      key: { kty: "EC", crv: "P-256", x: raw.subarray(1, 33).toString("base64url"), y: raw.subarray(33).toString("base64url") },
      format: "jwk",
    });
    assert.ok(
      crypto.verify("sha256", Buffer.from(`${h}.${p}`), { key: pub, dsaEncoding: "ieee-p1363" }, Buffer.from(sig, "base64url"))
    );
    assert.equal(JSON.parse(Buffer.from(p, "base64url").toString()).aud, "https://fcm.googleapis.com");

    assert.equal(isAllowedPushEndpoint("https://fcm.googleapis.com/fcm/send/abc"), true);
    assert.equal(isAllowedPushEndpoint("https://web.push.apple.com/QK"), true);
    assert.equal(isAllowedPushEndpoint("https://169.254.169.254/latest/meta-data"), false);
    assert.equal(isAllowedPushEndpoint("http://fcm.googleapis.com/x"), false);
    assert.equal(isAllowedPushEndpoint("https://fcm.googleapis.com.evil.example/x"), false);
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    resetVapidKeyCache();
  });

  // ---------------- Abo-Erkennung ----------------
  it("erkennt monatliche Abos samt Preiserhöhung und ignoriert unregelmäßige Händler", async () => {
    const { detectSubscriptions } = await import("../../src/lib/subscription-detection");
    const tx = (date: string, amountCents: number, merchant: string) => ({
      date, amountCents, merchant, description: `${merchant} Ref ${date}`, categoryId: "p3-cat-abo",
    });
    const txs = [
      tx("2026-07-03", 1799, "Netflix International B.V."),
      tx("2026-08-03", 1799, "Netflix International B.V."),
      tx("2026-09-03", 1799, "Netflix International B.V."),
      tx("2026-10-03", 1999, "Netflix International B.V."),
      tx("2026-11-03", 1999, "Netflix International B.V."),
      tx("2026-09-01", 4580, "REWE Markt 1042"),
      tx("2026-09-04", 2310, "REWE Markt 1042"),
      tx("2026-10-20", 6120, "REWE Markt 1042"),
      tx("2025-11-15", 8990, "ADAC"),
      tx("2026-11-14", 8990, "ADAC"),
      // beendetes Abo: letzte Buchung vor 5 Monaten
      tx("2026-03-10", 999, "Spotify AB"),
      tx("2026-04-10", 999, "Spotify AB"),
      tx("2026-05-10", 999, "Spotify AB"),
    ];
    const result = detectSubscriptions(txs, { today: "2026-11-24" });
    const netflix = result.find((s) => s.merchantKey.startsWith("netflix"));
    assert.ok(netflix, "Netflix erkannt");
    assert.equal(netflix!.interval, "monthly");
    assert.equal(netflix!.lastAmountCents, 1999);
    assert.equal(netflix!.nextExpectedDate, "2026-12-03");
    const adac = result.find((s) => s.merchantKey === "adac");
    assert.equal(adac?.interval, "yearly");
    assert.equal(result.some((s) => s.merchantKey.startsWith("rewe")), false);
    assert.equal(result.some((s) => s.merchantKey.startsWith("spotify")), false);

    // Bereits als Fixkosten erfasst → nur Preiserhöhungs-Hinweis
    const withExisting = detectSubscriptions(txs, {
      today: "2026-11-24",
      existing: [{ id: "rec-netflix", name: "Netflix", amountCents: 1799 }],
    });
    const hint = withExisting.find((s) => s.existingRecurringId === "rec-netflix");
    assert.ok(hint?.priceIncrease);
    assert.equal(hint?.existingAmountCents, 1799);

    const upToDate = detectSubscriptions(txs, {
      today: "2026-11-24",
      existing: [{ id: "rec-netflix", name: "Netflix", amountCents: 1999 }],
    });
    assert.equal(upToDate.some((s) => s.merchantKey.startsWith("netflix")), false);
  });

  // ---------------- CAMT ----------------
  it("liest CAMT.053 mit Namensraum-Präfixen, Storno und vorgemerkten Umsätzen", async () => {
    const { parseCamtStatement, isCamtXml } = await import("../../src/lib/camt-parser");
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ns:Document xmlns:ns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08"><ns:BkToCstmrStmt><ns:Stmt>
<ns:Acct><ns:Id><ns:IBAN>DE89370400440532013000</ns:IBAN></ns:Id><ns:Ccy>EUR</ns:Ccy></ns:Acct>
<ns:Ntry><ns:Amt Ccy="EUR">45.80</ns:Amt><ns:CdtDbtInd>DBIT</ns:CdtDbtInd><ns:Sts><ns:Cd>BOOK</ns:Cd></ns:Sts>
<ns:BookgDt><ns:Dt>2026-11-20</ns:Dt></ns:BookgDt><ns:AcctSvcrRef>REF-1</ns:AcctSvcrRef>
<ns:NtryDtls><ns:TxDtls><ns:RltdPties><ns:Cdtr><ns:Pty><ns:Nm>REWE Markt &amp; Co</ns:Nm></ns:Pty></ns:Cdtr></ns:RltdPties>
<ns:RmtInf><ns:Ustrd>Kartenzahlung</ns:Ustrd><ns:Ustrd>Filiale 1042</ns:Ustrd></ns:RmtInf></ns:TxDtls></ns:NtryDtls></ns:Ntry>
<ns:Ntry><ns:Amt Ccy="EUR">2500.00</ns:Amt><ns:CdtDbtInd>CRDT</ns:CdtDbtInd><ns:Sts>BOOK</ns:Sts>
<ns:BookgDt><ns:DtTm>2026-11-25T08:00:00</ns:DtTm></ns:BookgDt>
<ns:NtryDtls><ns:TxDtls><ns:RltdPties><ns:Dbtr><ns:Nm>Arbeitgeber GmbH</ns:Nm></ns:Dbtr></ns:RltdPties>
<ns:RmtInf><ns:Ustrd>Gehalt November</ns:Ustrd></ns:RmtInf></ns:TxDtls></ns:NtryDtls></ns:Ntry>
<ns:Ntry><ns:Amt Ccy="EUR">12.00</ns:Amt><ns:CdtDbtInd>DBIT</ns:CdtDbtInd><ns:RvslInd>true</ns:RvslInd><ns:Sts><ns:Cd>BOOK</ns:Cd></ns:Sts>
<ns:BookgDt><ns:Dt>2026-11-21</ns:Dt></ns:BookgDt><ns:AddtlNtryInf>Rücklastschrift</ns:AddtlNtryInf></ns:Ntry>
<ns:Ntry><ns:Amt Ccy="EUR">9.99</ns:Amt><ns:CdtDbtInd>DBIT</ns:CdtDbtInd><ns:Sts><ns:Cd>PDNG</ns:Cd></ns:Sts>
<ns:BookgDt><ns:Dt>2026-11-24</ns:Dt></ns:BookgDt></ns:Ntry>
</ns:Stmt></ns:BkToCstmrStmt></ns:Document>`;
    assert.equal(isCamtXml(xml), true);
    const st = parseCamtStatement(xml);
    assert.equal(st.iban, "DE89370400440532013000");
    assert.equal(st.transactions.length, 4);
    const [rewe, salary, reversal, pending] = st.transactions;
    assert.deepEqual(
      { date: rewe.date, amountCents: rewe.amountCents, type: rewe.type },
      { date: "2026-11-20", amountCents: 4580, type: "expense" }
    );
    assert.equal(rewe.description, "REWE Markt & Co – Kartenzahlung Filiale 1042");
    assert.equal(salary.type, "income");
    assert.equal(salary.date, "2026-11-25");
    assert.match(salary.description, /Arbeitgeber GmbH/);
    assert.equal(reversal.type, "income");
    assert.equal(pending.status, "pending");
    assert.throws(() => parseCamtStatement("<foo/>"), /Keine CAMT-Datei/);
  });

  // ---------------- Backups ----------------
  it("erstellt komprimierte, verschlüsselte Sicherungen mit Aufbewahrung", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cashflow-autobackup-"));
    process.env.BACKUP_DIR = dir;
    process.env.BACKUP_RETENTION_COUNT = "2";
    process.env.BACKUP_ENCRYPTION_KEY = "backup-schluessel-mindestens-32-zeichen-lang";
    const { runAutoBackup, listAutoBackups, readAutoBackupAsSqlite } = await import("../../src/lib/backup-scheduler");

    const first = await runAutoBackup({ now: new Date("2026-11-20T10:00:00Z") });
    assert.ok(first?.endsWith(".sqlite.gz.enc"));
    // Intervall noch nicht erreicht → keine neue Sicherung (Datei-Zeitstempel ist "jetzt")
    assert.equal(await runAutoBackup({ now: new Date() }), null);
    await runAutoBackup({ force: true, now: new Date("2026-11-21T10:00:00Z") });
    await runAutoBackup({ force: true, now: new Date("2026-11-22T10:00:00Z") });
    const list = listAutoBackups(dir);
    assert.equal(list.length, 2);
    assert.equal(list[0].name, "cashflow-20261122-100000.sqlite.gz.enc");

    const sqliteBytes = readAutoBackupAsSqlite(list[0].name, dir);
    assert.ok(sqliteBytes.subarray(0, 15).toString() === "SQLite format 3");
    // Rohdatei ist nicht als gzip lesbar (verschlüsselt)
    assert.throws(() => zlib.gunzipSync(fs.readFileSync(path.join(dir, list[0].name))));
    assert.throws(() => readAutoBackupAsSqlite("../app.db", dir), /Ungültiger Dateiname/);

    delete process.env.BACKUP_DIR;
    delete process.env.BACKUP_RETENTION_COUNT;
    delete process.env.BACKUP_ENCRYPTION_KEY;
  });

  // ---------------- Prognose & Vermögen ----------------
  it("berechnet Kontostand zum Monatsende und speichert Vermögensstände", async () => {
    const { computeLiquidityForecast, occurrencesBetween, snapshotBalances, getNetWorthHistory } =
      await import("../../src/lib/forecast");
    const now = new Date(2026, 10, 24, 12, 0, 0); // 24.11.2026
    const created = new Date();
    db.insert(schema.bankAccounts)
      .values([
        { id: "p3-giro", userId, accountExternalId: "g", accountName: "Giro", accountType: "checking", currency: "EUR", balanceCents: 200000, autoSync: false, createdAt: created, updatedAt: created },
        { id: "p3-savings", userId, accountExternalId: "s", accountName: "Tagesgeld", accountType: "savings", currency: "EUR", balanceCents: 500000, autoSync: false, createdAt: created, updatedAt: created },
        { id: "p3-card", userId, accountExternalId: "c", accountName: "Karte", accountType: "credit_card", currency: "EUR", balanceCents: -30000, autoSync: false, createdAt: created, updatedAt: created },
      ])
      .run();
    db.insert(schema.recurringExpenses)
      .values({
        id: "p3-rent", userId, categoryId: "p3-cat-abo", name: "Miete", amountCents: 90000, interval: "monthly",
        dayOfMonth: 28, startDate: "2026-01-28", nextDueDate: "2026-11-28", type: "expense", active: true, createdAt: created,
      })
      .run();
    // 90 Tage variable Ausgaben: 9000 € → 100 €/Tag
    db.insert(schema.transactions)
      .values({
        id: "p3-var", userId, categoryId: "p3-cat-food", type: "expense", costType: "variable", amountCents: 900000,
        date: "2026-10-15", description: "Einkäufe", createdAt: created, updatedAt: created,
      })
      .run();

    assert.deepEqual(occurrencesBetween("2026-11-03", "weekly", 3, "2026-11-10", "2026-11-30"), [
      "2026-11-10", "2026-11-17", "2026-11-24",
    ]);

    const f = computeLiquidityForecast(userId, now);
    assert.equal(f.startBalanceCents, 170000); // Giro + Karte, ohne Tagesgeld
    assert.equal(f.upcomingExpenseCents, 90000);
    assert.equal(f.remainingDays, 7);
    assert.equal(f.averageDailyVariableCents, 10000);
    assert.equal(f.projectedEndBalanceCents, 170000 - 90000 - 70000);

    const b = snapshotBalances(userId, "2026-11-24");
    assert.deepEqual(b, { liquidCents: 200000, savingsCents: 500000, debtCents: 30000, netWorthCents: 670000 });
    snapshotBalances(userId, "2026-11-24"); // idempotent
    assert.equal(getNetWorthHistory(userId, 10000).length, 1);
  });

  // ---------------- Inbox ----------------
  it("leitet Regelmuster ab und bestätigt Umsätze mit gelernter Regel", async () => {
    const { deriveRulePattern, getInboxCount } = await import("../../src/lib/inbox");
    const { confirmInboxTransactionAction, confirmAllInboxAction } = await import("../../src/actions/inbox-actions");
    const { findMatchingRule } = await import("../../src/lib/category-rules");

    assert.equal(deriveRulePattern("REWE Markt 1042 GmbH", ""), "rewe markt");
    assert.equal(deriveRulePattern(null, "PayPal *Spotify 123456"), "paypal *spotify");

    const created = new Date();
    db.insert(schema.transactions)
      .values([
        { id: "p3-inbox-1", userId, categoryId: "p3-cat-abo", type: "expense", costType: "variable", amountCents: 4580, date: "2026-11-20", description: "REWE Markt 1042", merchant: "REWE Markt 1042", reviewStatus: "pending", createdAt: created, updatedAt: created },
        { id: "p3-inbox-2", userId, categoryId: "p3-cat-abo", type: "expense", costType: "variable", amountCents: 999, date: "2026-11-21", description: "Kiosk", reviewStatus: "pending", createdAt: created, updatedAt: created },
      ])
      .run();
    assert.equal(getInboxCount(userId), 2);

    const res = await confirmInboxTransactionAction({ id: "p3-inbox-1", categoryId: "p3-cat-food", createRule: true });
    assert.equal(res.success, true);
    assert.equal(res.ruleCreated, true);
    const rules = db.select().from(schema.categoryRules).all();
    const match = findMatchingRule({ merchant: "REWE Markt 2210", description: "REWE Markt 2210" }, rules);
    assert.equal(match?.categoryId, "p3-cat-food");

    const foreign = await confirmInboxTransactionAction({ id: "p3-inbox-2", categoryId: "does-not-exist" });
    assert.equal(foreign.success, false);

    const all = await confirmAllInboxAction();
    assert.equal(all.confirmed, 1);
    assert.equal(getInboxCount(userId), 0);
  });

  // ---------------- Benachrichtigungen ----------------
  it("verschickt Budget-Hinweise einmalig und entfernt abgelaufene Geräte", async () => {
    const { runNotificationChecks, notifyUser } = await import("../../src/lib/notifications");
    const created = new Date();
    db.insert(schema.pushSubscriptions)
      .values([
        { id: "p3-sub-ok", userId, endpoint: "https://fcm.googleapis.com/ok", p256dh: "x", auth: "y", createdAt: created },
        { id: "p3-sub-gone", userId, endpoint: "https://fcm.googleapis.com/gone", p256dh: "x", auth: "y", createdAt: created },
      ])
      .run();
    db.insert(schema.budgets)
      .values({ id: "p3-budget", userId, categoryId: "p3-cat-food", amountCents: 50000, createdAt: created, updatedAt: created })
      .run();
    db.insert(schema.transactions)
      .values({
        id: "p3-food-nov", userId, categoryId: "p3-cat-food", type: "expense", costType: "variable", amountCents: 60000,
        date: "2026-11-10", description: "Großeinkauf", createdAt: created, updatedAt: created,
      })
      .run();

    const sent: Array<{ endpoint: string; title: string }> = [];
    const sender = async (sub: { endpoint: string }, payload: Record<string, unknown>) => {
      sent.push({ endpoint: sub.endpoint, title: String(payload.title) });
      return sub.endpoint.endsWith("/gone") ? ("gone" as const) : ("sent" as const);
    };

    await runNotificationChecks({ now: new Date("2026-11-24T12:00:00Z"), sender });
    const budgetMsgs = sent.filter((s) => s.title.startsWith("Budget überschritten"));
    assert.ok(budgetMsgs.length >= 1);
    assert.equal(
      db.select().from(schema.pushSubscriptions).all().some((s) => s.id === "p3-sub-gone"),
      false,
      "abgelaufenes Gerät entfernt"
    );

    sent.length = 0;
    await runNotificationChecks({ now: new Date("2026-11-24T13:00:00Z"), sender });
    assert.equal(sent.filter((s) => s.title.startsWith("Budget")).length, 0, "keine Wiederholung");

    const delivered = await notifyUser(userId, { title: "Test", body: "x" }, { sender, dedupeKey: "once" });
    assert.equal(delivered, 1);
    assert.equal(await notifyUser(userId, { title: "Test", body: "x" }, { sender, dedupeKey: "once" }), 0);
  });
});
