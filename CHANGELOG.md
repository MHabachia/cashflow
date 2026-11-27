# Changelog

Alle wichtigen Änderungen an Cashflow. Das Format folgt [Keep a Changelog](https://keepachangelog.com/de/1.1.0/), die Versionen folgen [Semantic Versioning](https://semver.org/lang/de/).

Die Versionen 0.0.1 bis 1.0.0 fassen die Entwicklung bis zum ersten veröffentlichten Stand in Stufen zusammen und haben deshalb kein Datum. Ab 1.1.0 wird je Release geführt.

## [Unreleased]

### Changed
- `lucide-react` auf 1.x aktualisiert.
- GitHub Actions aktualisiert (checkout 7, setup-node 7, Docker-Actions für Buildx, Login, Metadaten und Build).
- Dependabot fasst Action-Updates in einer PR zusammen und schlägt keine Hauptversionen mehr vor, die eine eigene Migration brauchen (Node.js, Next.js, TypeScript, Recharts).

### Security
- Gesperrte Benutzer erhalten über keinen Anmeldeweg mehr eine Sitzung, auch nicht per Passkey; sie sehen dabei den Hinweis auf die Sperre, der Versuch landet im Sicherheitsprotokoll. API-Routen (Belege, Profilbild, CSV-Export, Bank-Sync) behandeln gesperrte Benutzer als nicht angemeldet.
- Der Import (CSV, CAMT, PDF) bucht nur noch auf eigene Konten; eine fremde Konto-ID wird abgelehnt.
- Die Anlage von Import-Konten ist keine Server Action mehr und wertet `%` und `_` im Banknamen nicht als Platzhalter. Ein TF-Bank-Import ordnet sich nur noch Konten mit „TF Bank“ im Namen zu, nicht jedem Konto mit „tf“.
- Kategorien aus dem Client werden auf Eigentum geprüft: Massen-Update, Split-Buchungen, Regeln, Vorlagen, Fixkosten, Budgets und Elternkategorien nehmen keine fremden Kategorien mehr an. Split- und Regel-Listen zeigen keine fremden Kategorienamen.
- Eine Elternkategorie, die einen Kreis in der Hierarchie erzeugen würde (A → B → A), wird abgelehnt.
- Server Actions für Konten, Umbuchungen, Saldo-Abgleich, Sparziele, Massenaktionen und Fixkosten prüfen ihre Eingaben mit zod: Beträge nur als ganze Cent mit Obergrenze, nur echte Kalenderdaten, bekannte Kontoarten und Intervalle, begrenzte Textlängen. Vorher ließ sich z. B. ein String als Betrag übergeben, der per String-Verkettung im Saldo landete.
- Regeln für Server Actions festgehalten in `docs/adr/0001-server-action-vertrag.md`.
- `IP_ADDRESS_HEADERS=` (gesetzt, aber leer) vertraut wie dokumentiert keinem Header mehr. Vorher galt dann still der Standard `x-forwarded-for`, und über einen gefälschten Header ließ sich das Rate-Limit umgehen.
- Das Rate-Limit für Passwort-Reset und Wiederherstellungscodes ermittelt die Client-IP nach denselben Regeln wie die Anmeldung (`IP_ADDRESS_HEADERS`, `TRUSTED_PROXIES`) statt jedem `X-Forwarded-For`-Header zu glauben.
- Zwischengespeicherte Finanzdaten (Seiten-Cache des Service Workers, letzte Buchungen) werden auch auf der Anmeldeseite entfernt, also nach Ablauf der Sitzung. Meldet sich ein anderer Benutzer am selben Gerät an, werden alle lokalen Daten einschließlich der Offline-Queue verworfen, bevor etwas übertragen wird.
- Uploads (Belege, Profilbild, Logo) werden anhand der angekündigten Größe abgelehnt, bevor sie in den Speicher gelesen werden. Belegfotos haben ein Kontingent je Benutzer (`RECEIPTS_QUOTA_MB`, Standard 500 MB).
- Fehlermeldungen an die Oberfläche enthalten keine internen Details mehr (SQLite, Bildverarbeitung, Antworten der Bank-API). Durchgereicht werden nur bewusst für Nutzer formulierte Meldungen; alles andere landet im Server-Log. Weiterleitungen auf die Anmeldeseite gehen in Actions nicht mehr als Fehlermeldung „NEXT_REDIRECT“ verloren.
- `?bank_error=` enthält nur noch feste Codes. Vorher stand dort der Fehlertext der Bank-API, und über einen präparierten Link ließ sich ein beliebiger Text als Meldung der App anzeigen.
- CSV-Export: Formeln werden auch nach führenden Leerzeichen entschärft, Zeilenumbrüche vereinheitlicht und Steuerzeichen entfernt.
- Umbuchungen buchen bei wiederholter Anfrage nicht doppelt; „Buchen“/„Einbuchen“ bei Fixkosten ist gegen Doppelklick geschützt.
- Neue Wiederherstellungscodes erfordern bei Konten ohne Passwort (nur Passkey) eine frische Anmeldung (höchstens 10 Minuten alt).
- Profilbilder werden nur dem eigenen Benutzer und Admins ausgeliefert.
- Der Download einer Sicherung legt die Kopie in einem nur für den Prozess lesbaren Verzeichnis an, entfernt sie in jedem Fall und wird nicht zwischengespeichert (`Cache-Control: no-store`).
- Das öffentliche App-Icon wird zwischengespeichert statt bei jedem Abruf neu gerendert.

### Fixed
- „1.500“ wird als 1.500 € gelesen statt als 1,50 € (Tausenderpunkt ohne Komma). Auch „1,234.56“ (englisches Format) wird erkannt.
- CSV-Import ohne Typ-Spalte: Nutzt die Datei Vorzeichen, sind Beträge ohne Minus Einnahmen. Vorher wurde z. B. ein Gehalt „+2.500,00“ als Ausgabe gebucht und der Kontostand falsch verändert.

## [1.2.1] – 2026-11-26

Bank nach einem Schlüsselwechsel wieder verbinden.

### Fixed
- Scheitert der Abruf einer Bank (z. B. weil das Token nach einem Schlüsselwechsel nicht mehr lesbar ist), zeigt die Bankkarte jetzt „Neu verbinden“. Vorher gab es dafür nur „Zustimmung erneuern“ kurz vor Ablauf, und „Trennen“ hätte die Konten gelöscht.
- Beim erneuten Verbinden bleiben selbst vergebene Kontonamen erhalten; alte Abruffehler und die Abruf-Pause werden zurückgesetzt.
- Die Fehlermeldung bei unbekanntem Token-Schlüssel nennt jetzt „Neu verbinden“ als Lösung.

## [1.2.0] – 2026-11-26

Sicherheit und Betrieb gehärtet, Dokumentation aufgeteilt.

### Security
- Beispiel- und Platzhalter-Secrets (z. B. mit `changeme`, `eintragen`, `example`) werden in Produktion abgewiesen. Das Beispiel in der Dokumentation enthielt vorher ein Secret, das die Prüfung bestand.
- Docker-Images werden nur noch für Versions-Tags gebaut und erst, nachdem die komplette CI grün ist. Vorher wurde jeder Push auf `main` ungeprüft als `latest` veröffentlicht.
- `/api/health` gibt im Fehlerfall keine internen Fehlermeldungen mehr aus.
- `localhost` ist in Produktion kein vertrauenswürdiger Ursprung mehr für die Auth-API; zusätzliche Hosts kommen aus `TRUSTED_HOSTS`.
- Neue Passwörter müssen mindestens 12 statt 8 Zeichen lang sein.
- Das Demo-Seed mit bekanntem Passwort verweigert den Start in Produktion.
- Abhängigkeiten: PostCSS in Next.js über einen Override auf 8.5 angehoben (bekannte Schwachstellen); `npm audit --omit=dev` läuft in der CI.
- GitHub Actions auf Commit-SHAs festgelegt, Docker-Basis-Image auf Version und Digest.

### Changed
- `docker-compose.yml`: Port standardmäßig nur an `127.0.0.1` gebunden (`BIND_ADDRESS`), alle Variablen aus `.env` werden durchgereicht, Image-Version über `CASHFLOW_VERSION`, Härtung mit `no-new-privileges` und reduzierten Linux-Fähigkeiten.
- Ohne `AUTH_SECRET` erzeugt der Container beim ersten Start ein Secret und speichert es in `/data/.auth-secret`.
- Dockerfile nutzt `npm ci`; neue `.dockerignore` hält `.env`, `data/` und `.git` aus dem Build-Kontext.
- `scripts/backup.sh` sichert auch das automatisch erzeugte Secret und weist darauf hin, dass die Sicherung unverschlüsselt ist.
- Unit-Tests laufen plattformunabhängig (`scripts/run-unit-tests.mjs`), `engines` und `.nvmrc` legen Node.js 22 fest.
- `better-auth` als `^1.7.27` passend zu `@better-auth/passkey`; `@types/qrcode` unter `devDependencies`.
- Das nicht funktionierende Skript `npm run lint` entfernt, dafür `npm run typecheck`.
- Dokumentation aufgeteilt in `docs/` (Installation, Konfiguration, Bankanbindung, Sicherung, Sicherheit) mit Hinweisen zum Aktualisieren; doppelte Abschnitte in der README entfernt.

### Added
- `SECURITY.md` mit Meldeweg für Schwachstellen.
- Dependabot für npm, GitHub Actions und Docker.

## [1.1.0] – 2026-11-25

Einfachere Bedienung, neue Auswertungen, Werkzeuge für Admins.

### Changed
- Löschen einer Buchung mit „Rückgängig“ (6 Sekunden) statt Bestätigungsdialog.
- Prüfliste: Wischen nach rechts bestätigt, nach links öffnet die Kategorie.
- Umsatz-Filter bleiben in der Sitzung erhalten, dazu „Filter zurücksetzen“.
- Erste-Schritte-Liste (Konto, erste Buchung, erstes Budget) auf dem Dashboard.
- Das Dashboard startet mit Verfügbar-Betrag, Konten, Budgets und letzten Buchungen; Weiteres über „Anpassen“.
- Leere Zustände mit direktem Button, Mindestschrift 12 px, größere Tippflächen im Kopfbereich.

### Added
- Fixkosten-Kalender mit Warnung, wenn der Kontostand für die anstehenden Fixkosten nicht reicht.
- Monatsabschluss: Rückblick auf den Vormonat in den ersten zehn Tagen des Monats.
- Sparziele zeigen „Im Plan“ oder „hinter dem Plan“.
- Export: zusätzlich Summen je Kategorie als CSV.
- Admin: Systemzustand: Version, Alter der letzten Sicherung, freier Speicher, Bankverbindungen mit letztem Abruf und Restlaufzeit der Zustimmung.
- Admin: Sicherungen lassen sich prüfen (Integritätsprüfung in einer temporären Datenbank, Eintrag im Sicherheitsprotokoll).
- Admin: Update-Hinweis auf neue Releases. Es werden keine Nutzerdaten gesendet; abschaltbar mit `UPDATE_CHECK=false`.
- Admin: Branding: Vorschau, freie Hex-Eingabe und Kontrastwarnung für die Akzentfarbe.
- Admin: Einladungen mit wählbarer Gültigkeit (1, 7 oder 30 Tage).
- Admin: Sicherheitsprotokoll mit Filter und Suche; Hinweis bei vielen Fehlversuchen innerhalb von 24 Stunden.

## 1.0.0 – Ruhigere Oberfläche

- Einheitlicher, zurückhaltender Stil: eine Akzentfarbe, Farbe nur mit Bedeutung (Grün für Einnahmen, Rot für Negatives), Beträge in Tabellenziffern, Listen mit Trennlinien statt Kachelstapeln.
- Dashboard mit der Kennzahl „Verfügbar bis Monatsende“; Konten, Budgets und Kategorien als Listen.
- Kopfbereich mit Textnavigation; Umsätze, Schnellerfassung, Prüfliste, Fixkosten, Banking, Kategorien, Einstellungen, Admin und Anmeldung im gleichen Stil.
- Die vom Admin gewählte Akzentfarbe gilt für Buttons, Fortschrittsbalken und Diagramme.
- Standard-Zahlungsart „Karte“ (Migration 9).

## 0.9.0 – Auswertung und Komfort

- Umsätze prüfen: neue Bank- und Importbuchungen landen in einer Prüfliste.
- Abo-Erkennung und Hinweis auf Preiserhöhungen bei Fixkosten.
- Prognose zum Monatsende und täglich gespeicherter Nettovermögensverlauf.
- Automatische Erkennung von Umbuchungen zwischen eigenen Konten.
- Import von CAMT.053-Kontoauszügen.
- Push-Benachrichtigungen (Budgets, ablaufender Bankzugriff, hohe Abbuchungen, offene Umsätze).
- Passwort vergessen ohne E-Mail: Wiederherstellungscodes, Einmal-Link vom Admin, Notfall-Befehl auf dem Server.
- Korrekturen an der Berechnungslogik: Umbuchungen neutral, Splits aufgelöst, Erstattungen mindern Ausgaben.

## 0.8.0 – Härtung

- Registrierung nur per Einladung; Einladungen werden atomar eingelöst.
- Content-Security-Policy mit Nonce, HSTS, Schutz vor Host-Header-Injection.
- Eigener Schlüssel für Bank-Tokens (HKDF, Schlüssel-ID, Rotation).
- Sicherheitsprotokoll mit 12 Monaten Aufbewahrung.
- Sichere Wiederherstellung: Prüfung der Datei, Einspielen beim nächsten Start.
- Sitzungen ohne Cookie-Cache, damit gesperrte Konten sofort abgewiesen werden.
- Automatische, optional verschlüsselte Sicherungen.

## 0.7.0 – Betrieb

- Docker-Image für amd64 und arm64 über GitHub Container Registry, Healthcheck `/api/health`.
- Versionierte Datenbankmigrationen mit Protokoll in `schema_migrations`.
- CI: Typprüfung, Unit-Tests, Playwright-Tests, Build und Container-Test.
- Sicherungsskript für Datenbank und Uploads.

## 0.6.0 – Konten und Sicherheit

- Passkeys (WebAuthn) und Zwei-Faktor-Anmeldung (TOTP) mit Wiederherstellungscodes.
- Admin-Bereich: Benutzer anlegen, Rollen, Sperren, Einladungslinks, Branding (Name, Akzentfarbe, Logo).
- Rate-Limit und Kontosperre gegen Brute-Force.
- Mehrere Geräte-Sitzungen einsehen und beenden.

## 0.5.0 – Auswertung und Kategorien

- Jahresbericht mit 12-Monats-Vergleich und CSV-Export.
- Split-Buchungen auf mehrere Kategorien.
- Haupt- und Unterkategorien.
- Regeln zur automatischen Kategorisierung, auch rückwirkend.
- Import von PDF-Kontoauszügen.

## 0.4.0 – Bankanbindung

- Abruf von Umsätzen über PSD2 (Enable Banking), nur lesend.
- Bank-Tokens verschlüsselt mit AES-256-GCM.
- Hintergrund-Sync mit Begrenzung auf 4 Abrufe pro Konto und Tag, Erkennung abgelaufener Zustimmungen.
- Sandbox-Modus mit Testkonten.

## 0.3.0 – Konten

- Manuelle Konten, Kreditkarten und Bargeld mit Salden.
- Umbuchungen zwischen Konten.
- CSV-Import und -Export.
- Sparziele.

## 0.2.0 – App-Funktionen

- Installierbare PWA mit Offline-Erfassung und Synchronisation im Hintergrund.
- Hell- und Dunkelmodus.
- Suche und Schnellaktionen mit Tastenkürzel (Strg/Cmd + K).
- Belegfotos mit Prüfung und Neukodierung beim Upload.

## 0.1.0 – Erfassung und Planung

- Schnellerfassung mit Vorlagen.
- Fixkosten und Einnahmen mit Intervall und automatischer Buchung.
- Monatsbudgets mit Warnung bei 80 % und 100 %.
- Dashboard mit Monatsbilanz und Diagrammen.

## 0.0.1 – Grundgerüst

- Next.js, TypeScript, SQLite mit Drizzle, Anmeldung mit Better Auth.
- Kategorien und manuell erfasste Buchungen.

[Unreleased]: https://github.com/MHabachia/cashflow/compare/v1.2.1...HEAD
[1.2.1]: https://github.com/MHabachia/cashflow/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/MHabachia/cashflow/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/MHabachia/cashflow/releases/tag/v1.1.0
