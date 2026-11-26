# Sicherung und Wiederherstellung

Alle Daten liegen in `./data`: die SQLite-Datenbank `app.db`, die Belegfotos, Logos und Profilbilder in `uploads/` und, falls kein `AUTH_SECRET` gesetzt ist, das automatisch erzeugte Secret `.auth-secret`.

## Automatische Sicherungen

Die App sichert die Datenbank standardmäßig täglich nach `./data/backups` und behält die letzten 14 Sicherungen. Mit `BACKUP_ENCRYPTION_KEY` werden sie mit AES-256-GCM verschlüsselt; ohne diesen Schlüssel lassen sie sich dann nicht mehr einspielen. Im Admin-Bereich lassen sich Sicherungen anstoßen, herunterladen und prüfen. **Belegfotos sind darin nicht enthalten.**

## Manuelle Sicherung mit Skript

```bash
./scripts/backup.sh ./data ./backups
```

Erzeugt in `./backups`:

- `app_<Zeitstempel>.db`: konsistenter Schnappschuss der Datenbank,
- `uploads_<Zeitstempel>.tar.gz`: alle Belegfotos und Bilder,
- `auth-secret_<Zeitstempel>`: das automatisch erzeugte Secret, falls vorhanden.

**Diese Dateien sind nicht verschlüsselt.** Den Ordner geschützt aufbewahren oder zusätzlich verschlüsseln, z. B. mit `age` oder `gpg`.

## Wiederherstellen

**Datenbank über die App** (Werkzeuge → Backup): Die hochgeladene Datei wird geprüft (Integrität, Schema) und als `app.db.restore-pending` vorgemerkt. Eingespielt wird sie beim nächsten Neustart; der bisherige Stand bleibt als `app.db.bak-<Zeitstempel>` erhalten (die letzten drei).

**Datenbank von Hand:** Container stoppen, Datei ersetzen, starten:

```bash
docker compose stop
cp backups/app_<Zeitstempel>.db data/app.db
rm -f data/app.db-wal data/app.db-shm
docker compose start
```

**Belegfotos:**

```bash
docker compose stop
tar -xzf backups/uploads_<Zeitstempel>.tar.gz -C ./data
docker compose start
```

Der Container setzt die Dateirechte beim Start selbst.

**Secret:** Wurde `.auth-secret` automatisch erzeugt, gehört es zur Datenbank. Ohne das passende Secret sind alle Sitzungen ungültig und, falls kein eigener `TOKEN_ENCRYPTION_KEY` gesetzt war, auch die gespeicherten Bankzugänge. Zurückkopieren mit `cp backups/auth-secret_<Zeitstempel> data/.auth-secret`.
