import { test, expect } from "@playwright/test";

test.describe("Cashflow PWA – UI & End-to-End Tests", () => {
  test("1. Healthcheck-Endpunkt (/api/health) und PWA-Manifest (/manifest.webmanifest) sind erreichbar", async ({
    request,
  }) => {
    const healthRes = await request.get("/api/health");
    expect(healthRes.ok()).toBeTruthy();
    const healthJson = await healthRes.json();
    expect(healthJson.status).toBe("ok");
    expect(healthJson.database).toBe("connected");

    const manifestRes = await request.get("/manifest.webmanifest");
    expect(manifestRes.ok()).toBeTruthy();
    const manifestJson = await manifestRes.json();
    expect(manifestJson.display).toBe("standalone");
  });

  test("2. Login, Dashboard, Schnellerfassung (Variable Vorlage & Neueintrag), Fixkosten & Admin-Panel", async ({
    page,
  }) => {
    // Unauthentifizierter Aufruf leitet auf /login weiter
    await page.goto("/");
    await expect(page).toHaveURL(/\/login/);
    await page.waitForLoadState("domcontentloaded");

    // Login mit Seed-Admin
    await page.fill('input[type="email"]', "admin@kosten.local");
    await page.fill('input[type="password"]', "AdminPassword123!");
    await page.click('button[type="submit"]');

    // Dashboard lädt mit aktuellem Monat, Fixkosten & Variablen Kosten (erhöhter Timeout für CI-Runner)
    await expect(page).toHaveURL("/", { timeout: 15000 });
    await expect(page.getByText("Budgets").first()).toBeVisible();
    await expect(
      page.getByText("Fixkosten", { exact: true }).first()
    ).toBeVisible();
    await expect(
      page.getByText("Variable Ausgaben", { exact: true }).first()
    ).toBeVisible();

    // Schnellerfassung über den großen "+"-Button in der Bottom-Navigation öffnen
    await page.click('button[aria-label="Schnellerfassung öffnen"]');
    await expect(
      page.getByText("Vorlagen", { exact: true })
    ).toBeVisible();

    // 1-Tap-Vorlage "Bäcker & Kaffee" antippen und speichern
    await page.click('button:has-text("Bäcker & Kaffee")');
    await page.click('button:has-text("Jetzt speichern")');

    // Navigation zu Einträgen (/transactions)
    // Nur den sichtbaren Link (Kopf-Navigation ist auf dem Handy per CSS ausgeblendet)
    await page.locator('a[href="/transactions"]:visible').first().click();
    await expect(page).toHaveURL(/\/transactions/);
    await expect(page.getByText("Bäcker & Kaffee").first()).toBeVisible();

    // Navigation zu Monatlichen Fixkosten (/recurring)
    // Nur den sichtbaren Link (Kopf-Navigation ist auf dem Handy per CSS ausgeblendet)
    await page.locator('a[href="/recurring"]:visible').first().click();
    await expect(page).toHaveURL(/\/recurring/);
    await expect(page.getByText("Monatliche Fixkosten").first()).toBeVisible();
    await expect(page.getByText("Warmmiete Wohnung")).toBeVisible();
    await expect(page.getByRole("button", { name: "Einnahme", exact: true })).toBeVisible();
    await expect(
      page.getByText("Feste Einnahmen (Gehalt & Eingänge)")
    ).toBeVisible();

    // Navigation zum dedizierten Banking-Hub (/banking) über Bottom-Nav
    // Nur den sichtbaren Link (Kopf-Navigation ist auf dem Handy per CSS ausgeblendet)
    await page.locator('a[href="/banking"]:visible').first().click();
    await expect(page).toHaveURL(/\/banking/);
    await expect(page.getByRole("heading", { name: "Konten", exact: true })).toBeVisible();
    await expect(page.getByText(/^Gesamt · \d+ Konten?$/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Bank verbinden" }).first()).toBeVisible();

    // Modal zum Verbinden einer Bank öffnen
    await page.getByRole("button", { name: "Bank verbinden" }).first().click();
    await expect(
      page.getByPlaceholder("Bankname suchen")
    ).toBeVisible();
    // Nur sichtbare Treffer: „ING“ steckt sonst auch in „Bank·ing“ der (auf dem Handy versteckten) Kopf-Navigation
    await expect(page.getByText(/^ING\b/).filter({ visible: true }).first()).toBeVisible();
    await expect(page.getByText("C24 Bank").filter({ visible: true }).first()).toBeVisible();

    // Navigation zum Admin-Panel (/admin)
    await page.goto("/admin");
    await expect(
      page.getByText("Admin-Panel & App-Grundgerüst")
    ).toBeVisible();
    await expect(page.getByText("Benutzerkonten verwalten")).toBeVisible();

    // Tab-Wechsel zu Branding & App-Einstellungen im Admin-Panel
    await page.click('button:has-text("Branding & App")');
    await expect(
      page.getByText("Branding & Globale App-Konfiguration")
    ).toBeVisible();

    // Info-Seite (/info) über Header-Button öffnen und Techstack + API-Routes prüfen
    // System-Info liegt im Profilmenü
    await page.click('button[aria-label="Benutzerprofil & Menü öffnen"]');
    await page.click('a[aria-label="System-Info (nur Admins)"]');
    await expect(page).toHaveURL(/\/info/);
    await expect(page.getByText("Techstack & Architektur")).toBeVisible();
    await expect(page.getByText("API-Endpunkte")).toBeVisible();
    await expect(page.getByText("GitHub Repository")).toBeVisible();
  });

  test("3. Löschen in der Umsatzliste blendet die Zeile sofort aus, „Rückgängig“ holt sie zurück", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.fill('input[type="email"]', "admin@kosten.local");
    await page.fill('input[type="password"]', "AdminPassword123!");
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL("/", { timeout: 15000 });

    // Eigene Buchung mit eindeutigem Text über die Vorlage anlegen
    const description = `E2E Löschtest ${Date.now()}`;
    await page.click('button[aria-label="Schnellerfassung öffnen"]');
    await page.click('button:has-text("Bäcker & Kaffee")');
    await page.fill('input[placeholder^="z. B. Bäcker"]', description);
    await page.click('button:has-text("Jetzt speichern")');
    // Dialog schließt erst nach erfolgreichem Speichern
    await expect(page.getByRole("dialog", { name: "Buchung erfassen" })).toBeHidden({ timeout: 10000 });

    await page.goto("/transactions");
    const text = page.getByText(description, { exact: true });
    await expect(text).toBeVisible();
    // Jede Zeile hat einen eigenen „Löschen“-Button (auf dem Handy erst nach „Aktionen anzeigen“ sichtbar);
    // „Aktionen anzeigen“ selbst verschwindet nach dem Klick und taugt nicht zum Abgrenzen der Zeile
    const row = text.locator('xpath=ancestor::div[.//button[@title="Löschen"]][1]');
    await row.getByRole("button", { name: "Aktionen anzeigen" }).click();
    await row.getByTitle("Löschen").click();

    // Sofort ausgeblendet, nicht erst nach Ablauf der 6-Sekunden-Frist
    await expect(text).toBeHidden({ timeout: 3000 });

    await page.getByRole("button", { name: "Rückgängig" }).click();
    await expect(page.getByText(description, { exact: true })).toBeVisible({ timeout: 3000 });
  });

  test("4. Suche und Monatsfilter der Umsatzliste laufen über die Adresse und den Server", async ({ page }) => {
    await page.goto("/login");
    await page.fill('input[type="email"]', "admin@kosten.local");
    await page.fill('input[type="password"]', "AdminPassword123!");
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL("/", { timeout: 15000 });

    // Seed-Buchung „Frischeinkauf & Getränke“ über alle Monate suchen
    await page.goto("/transactions?month=all");
    await page.fill('input[placeholder^="Suche nach"]', "frischeinkauf");
    await expect(page).toHaveURL(/q=frischeinkauf/, { timeout: 5000 });
    await expect(page.getByText("Frischeinkauf & Getränke").first()).toBeVisible();
    await expect(page.getByText("Bäcker & Kaffee")).toHaveCount(0);

    // Direkter Aufruf mit Filtern in der Adresse liefert dasselbe Ergebnis
    await page.goto("/transactions?month=all&q=frischeinkauf");
    await expect(page.getByText("Frischeinkauf & Getränke").first()).toBeVisible();
    await expect(page.getByText("Bäcker & Kaffee")).toHaveCount(0);
  });

  test("5. Dialoge: Fokus, Escape und App-Rückfrage statt Browser-confirm", async ({ page }) => {
    // Ein Login für beide Prüfungen: Die Anmeldung ist auf 5 Versuche pro Minute begrenzt (#57)
    const browserDialogs: string[] = [];
    page.on("dialog", (d) => {
      browserDialogs.push(d.message());
      void d.dismiss();
    });
    await page.goto("/login");
    await page.fill('input[type="email"]', "admin@kosten.local");
    await page.fill('input[type="password"]', "AdminPassword123!");
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL("/", { timeout: 15000 });

    // Dialog: Fokus im Dialog, Escape schließt, Fokus zurück auf dem Auslöser
    const trigger = page.getByRole("button", { name: /Dashboard anpassen|Anpassen/ }).first();
    await trigger.click();
    const widgets = page.getByRole("dialog", { name: "Dashboard-Widgets & Ansicht anpassen" });
    await expect(widgets).toBeVisible();
    await expect(widgets).toHaveAttribute("aria-modal", "true");
    await expect.poll(() => widgets.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    // Sparziel-Widget einschalten (standardmäßig ausgeblendet)
    await widgets.getByRole("button", { name: "Sparziele & Sinking Funds ein- oder ausschalten" }).click();
    await page.keyboard.press("Escape");
    await expect(widgets).toBeHidden();
    await expect(trigger).toBeFocused();

    // Rückfrage beim Löschen eines Sparziels im App-Dialog
    const goalName = `E2E Ziel ${Date.now()}`;
    await page.getByRole("button", { name: "Ziel anlegen" }).click();
    await page.fill('input[placeholder^="z. B. Notgroschen"]', goalName);
    await page.fill('input[placeholder="3.000,00"]', "500");
    await page.getByRole("button", { name: "Anlegen", exact: true }).click();
    await expect(page.getByText(goalName)).toBeVisible();

    const confirmDialog = page.getByRole("dialog", { name: "Sparziel löschen?" });
    await page.getByRole("button", { name: `${goalName} löschen` }).click();
    await expect(confirmDialog).toBeVisible();
    await confirmDialog.getByRole("button", { name: "Abbrechen" }).click();
    await expect(confirmDialog).toBeHidden();
    await expect(page.getByText(goalName)).toBeVisible();

    await page.getByRole("button", { name: `${goalName} löschen` }).click();
    await confirmDialog.getByRole("button", { name: "Löschen", exact: true }).click();
    await expect(confirmDialog).toBeHidden();
    // Meldung zuerst prüfen: Zeigt bei einem Fehlschlag, ob der Server gelöscht hat
    await expect(page.getByText("Sparziel gelöscht.")).toBeVisible();
    await expect(page.getByText(goalName)).toBeHidden({ timeout: 10000 });
    expect(browserDialogs).toEqual([]);
  });
});
