# Changelog

Die Versionen 0.0.1 bis 1.0.0 fassen die Entwicklung bis zum ersten veröffentlichten Stand in Stufen zusammen. Ab 1.1.0 wird je Release geführt.

## 1.1.0

Einfachere Bedienung, neue Auswertungen, Werkzeuge für Admins.

### Oberfläche
- Löschen einer Buchung mit „Rückgängig“ (6 Sekunden) statt Bestätigungsdialog.
- Prüfliste: Wischen nach rechts bestätigt, nach links öffnet die Kategorie.
- Umsatz-Filter bleiben in der Sitzung erhalten, dazu „Filter zurücksetzen“.
- Erste-Schritte-Liste (Konto, erste Buchung, erstes Budget) auf dem Dashboard.
- Das Dashboard startet mit Verfügbar-Betrag, Konten, Budgets und letzten Buchungen; Weiteres über „Anpassen“.
- Leere Zustände mit direktem Button, Mindestschrift 12 px, größere Tippflächen im Kopfbereich.

### Neue Funktionen
- Fixkosten-Kalender mit Warnung, wenn der Kontostand für die anstehenden Fixkosten nicht reicht.
- Monatsabschluss: Rückblick auf den Vormonat in den ersten zehn Tagen des Monats.
- Sparziele zeigen „Im Plan“ oder „hinter dem Plan“.
- Export: zusätzlich Summen je Kategorie als CSV.

### Admin
- Systemzustand: Version, Alter der letzten Sicherung, freier Speicher, Bankverbindungen mit letztem Abruf und Restlaufzeit der Zustimmung.
- Sicherungen lassen sich prüfen (Integritätsprüfung in einer temporären Datenbank, Eintrag im Sicherheitsprotokoll).
- Update-Hinweis auf neue Releases. Es werden keine Nutzerdaten gesendet; abschaltbar mit `UPDATE_CHECK=false`.
- Branding: Vorschau, freie Hex-Eingabe und Kontrastwarnung für die Akzentfarbe.
- Einladungen mit wählbarer Gültigkeit (1, 7 oder 30 Tage).
- Sicherheitsprotokoll mit Filter und Suche; Hinweis bei vielen Fehlversuchen innerhalb von 24 Stunden.

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
