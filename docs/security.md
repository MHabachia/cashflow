# Sicherheit

Schwachstellen bitte vertraulich melden, siehe [SECURITY.md](../SECURITY.md).

## Überblick

- **Anmeldung:** Passkeys (WebAuthn) und TOTP-2FA; Passwörter mit scrypt gehasht; Sitzungen über `httpOnly`-Cookies, ohne Cookie-Cache, damit gesperrte Konten sofort draußen sind.
- **Brute-Force-Schutz:** Rate-Limit pro IP in der Datenbank (5 pro Minute für Anmeldung, 2FA und Passwortänderung) und Kontosperre nach 10 Fehlversuchen in 15 Minuten. Die Client-IP kommt aus `IP_ADDRESS_HEADERS` / `TRUSTED_PROXIES`.
- **Registrierung:** Nur der erste Benutzer wird Admin. Danach geht es nur über befristete, einmal einlösbare Einladungen oder direkt durch einen Admin. Der Better-Auth-Endpunkt `/api/auth/sign-up/*` ist gesperrt.
- **Mandantentrennung:** Jede Abfrage und jede Server Action filtert serverseitig auf den angemeldeten Benutzer; Belegfotos werden nur an ihren Besitzer ausgeliefert.
- **Uploads:** Bilder werden per `sharp` geprüft (Magic Bytes, Pixel-Limit), als WebP neu kodiert (entfernt EXIF) und gegen Path-Traversal abgesichert.
- **Eingaben:** Parametrisierte Abfragen über Drizzle, Validierung mit Zod; CSV-Export entschärft Formel-Präfixe (`=`, `+`, `-`, `@`).
- **HTTP:** Content-Security-Policy mit Nonce, HSTS unter HTTPS, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`. Redirect-URLs werden nur aus `APP_URL` und `TRUSTED_HOSTS` gebildet.
- **Container:** Start als Root nur zum Korrigieren der Rechte von `/data`, danach unprivilegierter Benutzer (UID 1001).
- **Banking:** Nur lesender Zugriff (AIS), keine Zahlungsauslösung. Bank-Logins laufen ausschließlich bei der Bank. Tokens werden mit AES-256-GCM verschlüsselt (Schlüssel per HKDF aus `TOKEN_ENCRYPTION_KEY`, mit Rotation). Höchstens 4 automatische Abrufe pro Konto und Tag; doppelte Umsätze werden über `(bank_account_id, bank_transaction_id)` verhindert.
- **Protokoll und Sicherungen:** Sicherheitsprotokoll mit 12 Monaten Aufbewahrung; hochgeladene Sicherungen werden geprüft und erst beim Neustart eingespielt; beim Abmelden werden lokale Offline-Daten und Caches entfernt.

## Secret für Sitzungen

`AUTH_SECRET` muss mindestens 32 Zeichen lang sein. Bekannte Platzhalter aus Beispielen (etwa mit `changeme`, `eintragen` oder `example`) werden in Produktion abgewiesen, der Container startet dann nicht. Ist kein Secret gesetzt, erzeugt der Container beim ersten Start eines und speichert es in `/data/.auth-secret` (nur für den Besitzer lesbar).

## Passwörter

Neue Passwörter müssen mindestens 12 Zeichen lang sein. Bestehende kürzere Passwörter bleiben gültig, bis sie geändert werden.

## Kontosperre

Nach 10 falschen Passwort-Anmeldungen innerhalb von 15 Minuten wird das Konto für den Rest des Zeitfensters für Passwort-Anmeldungen gesperrt. Einschränkungen:

- Die Sperre liegt im Arbeitsspeicher: Sie gilt pro Instanz und ist nach einem Neustart aufgehoben.
- Wer die E-Mail-Adresse kennt, kann ein Konto auf diese Weise gezielt 15 Minuten aussperren. Die Anmeldung mit Passkey ist davon nicht betroffen.

## Bekannte Einschränkungen

- Die Content-Security-Policy erlaubt `style-src 'unsafe-inline'`, weil Recharts und sonner Inline-Styles setzen. Für Skripte gilt eine Nonce mit `strict-dynamic`.
- HSTS wird ohne `includeSubDomains` und `preload` gesetzt, damit andere Dienste auf Subdomains nicht ungewollt auf HTTPS gezwungen werden.
- `/api/health` ist ohne Anmeldung erreichbar und meldet nur „ok“ oder „error“, ohne Details.

## Passwort vergessen (ohne E-Mail-Versand)

Cashflow braucht keinen Mailserver. Es gibt drei Wege zurück ins Konto:

1. **Wiederherstellungscodes (selbst):** Unter *Einstellungen → Wiederherstellungscodes* acht Einmal-Codes erzeugen und sicher aufbewahren. Auf der Anmeldeseite unter *Passwort vergessen?* E-Mail, Code und neues Passwort eingeben.
2. **Link vom Admin:** Im Admin-Bereich beim Benutzer auf das Schlüssel-Symbol → *Link erstellen*. Der Link ist 24 Stunden gültig, nur einmal verwendbar und wird z. B. per Messenger weitergegeben. Der Admin sieht das neue Passwort nie.
3. **Notfall-Befehl auf dem Server** (z. B. wenn sich der einzige Admin ausgesperrt hat):

   ```bash
   docker exec -u nextjs cashflow-app node reset-password.mjs admin@example.com
   ```

   Gibt einen Einmal-Link aus (1 Stunde gültig). Lokal: `node scripts/reset-password.mjs admin@example.com`.

Nach jedem Zurücksetzen werden alle Sitzungen des Kontos beendet; jeder Vorgang landet im Sicherheitsprotokoll.
