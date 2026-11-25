import { chromium, type Page } from "playwright";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * Erzeugt die README-Screenshots aus einer frisch befüllten Demo-Datenbank.
 *
 * Voraussetzung: `npm run build`. Aufruf: `npx tsx scripts/take-screenshots.ts`
 * Die echte Datenbank (data/app.db) wird dabei nicht angefasst.
 */

const screenshotsDir = path.resolve("./public/screenshots");
const dbPath = path.resolve("./data/screenshots.db");
const port = 3199;
const baseUrl = `http://127.0.0.1:${port}`;
const secret = "sicheres-screenshot-skript-secret-fuer-den-lokalen-test-123456";

const env: NodeJS.ProcessEnv = {
  ...process.env,
  NODE_ENV: "production",
  PORT: String(port),
  AUTH_SECRET: secret,
  BETTER_AUTH_SECRET: secret,
  BETTER_AUTH_URL: baseUrl,
  APP_URL: baseUrl,
  NEXT_PUBLIC_APP_URL: baseUrl,
  DATABASE_PATH: dbPath,
  UPLOADS_DIR: path.resolve("./data/screenshots-uploads"),
  BACKUP_DIR: path.resolve("./data/screenshots-backups"),
  BANK_SYNC_MOCK: "true",
  BANK_SYNC_AUTO_ENABLED: "false",
};

function prepareDatabase() {
  for (const suffix of ["", "-wal", "-shm"]) {
    if (fs.existsSync(dbPath + suffix)) fs.unlinkSync(dbPath + suffix);
  }
  for (const script of ["db:migrate", "db:seed"]) {
    const res = spawnSync("npm", ["run", script], { env: { ...env, NODE_ENV: "development" } as NodeJS.ProcessEnv, stdio: "inherit" });
    if (res.status !== 0) throw new Error(`npm run ${script} fehlgeschlagen`);
  }
}

async function login(page: Page) {
  await page.goto(`${baseUrl}/login`);
  await page.fill('input[type="email"]', "admin@kosten.local");
  await page.fill('input[type="password"]', "AdminPassword123!");
  await page.click('button[type="submit"]');
  await page.waitForURL(`${baseUrl}/`, { timeout: 15000 });
  await page.waitForTimeout(1000);
  // Begrüßungs-Toast ausblenden, damit er nicht auf den Bildern landet
  await page.locator("[data-sonner-toast]").evaluateAll((els) => els.forEach((e) => e.remove()));
}

async function shot(page: Page, name: string, url?: string) {
  if (url) {
    await page.goto(`${baseUrl}${url}`);
    await page.waitForTimeout(900);
  }
  console.log(`Erstelle Screenshot: ${name}`);
  await page.screenshot({ path: path.join(screenshotsDir, name), fullPage: false });
}

async function main() {
  fs.mkdirSync(screenshotsDir, { recursive: true });
  prepareDatabase();

  console.log(`Starte Server auf Port ${port}...`);
  const server = spawn("npx", ["next", "start", "-p", String(port), "-H", "127.0.0.1"], {
    env,
    stdio: "inherit",
  });

  try {
    let ready = false;
    for (let i = 0; i < 60 && !ready; i++) {
      try {
        ready = (await fetch(`${baseUrl}/api/health`)).ok;
      } catch {
        // noch nicht bereit
      }
      if (!ready) await new Promise((r) => setTimeout(r, 1000));
    }
    if (!ready) throw new Error("Server konnte nicht rechtzeitig gestartet werden.");

    const browser = await chromium.launch({ headless: true });

    // ---------- Mobil (iPhone 14) ----------
    const mobile = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    });
    // Installationshinweis für iOS ausblenden, damit er nicht auf jedem Bild landet
    await mobile.addInitScript(() => {
      try {
        localStorage.setItem("kosten_ios_install_dismissed", "1");
      } catch {
        // ignorieren
      }
    });
    const anon = await mobile.newPage();
    await shot(anon, "forgot-password.png", "/forgot-password");
    await anon.close();

    const page = await mobile.newPage();
    await login(page);
    await shot(page, "dashboard.png");

    await page.click('button[aria-label="Schnellerfassung öffnen"]');
    await page.waitForTimeout(600);
    await shot(page, "quick-add.png");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);

    await shot(page, "transactions.png", "/transactions");
    await shot(page, "inbox.png", "/inbox");
    await shot(page, "fixed-costs.png", "/recurring");
    await shot(page, "bank-connections.png", "/banking");
    await shot(page, "security-settings.png", "/settings");
    await shot(page, "admin-panel.png", "/admin");
    await shot(page, "system-info.png", "/info");
    await mobile.close();

    // ---------- Desktop (1280×800) ----------
    const desktop = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
    const dpage = await desktop.newPage();
    await login(dpage);
    await shot(dpage, "desktop-view.png");

    // Nur das Widget „Prognose & Nettovermögen“ abbilden
    const forecast = dpage
      .getByRole("heading", { name: "Kontostand am Monatsende" })
      .locator("xpath=ancestor::div[contains(@class,'grid')][1]");
    if (await forecast.count()) {
      await forecast.scrollIntoViewIfNeeded();
      await dpage.waitForTimeout(400);
      console.log("Erstelle Screenshot: forecast.png");
      await forecast.screenshot({ path: path.join(screenshotsDir, "forecast.png") });
    }

    await shot(dpage, "annual-report.png", "/reports");
    await desktop.close();
    await browser.close();

    // Bild der entfernten Funktion „Kleingeld Plus“ aufräumen
    const legacy = path.join(screenshotsDir, "roundup-savings.png");
    if (fs.existsSync(legacy)) fs.unlinkSync(legacy);

    console.log("Alle Screenshots erfolgreich aktualisiert!");
  } finally {
    server.kill();
  }
}

main().catch((err) => {
  console.error("Fehler beim Erstellen der Screenshots:", err);
  process.exit(1);
});
