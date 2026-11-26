# Konfiguration

Alle Einstellungen werden über Umgebungsvariablen gesetzt, am einfachsten in einer `.env` neben der `docker-compose.yml` (Vorlage: [`.env.example`](../.env.example)). Die mitgelieferte `docker-compose.yml` reicht alle Variablen aus `.env` an die App durch.

| Variable | Beschreibung | Standard |
|---|---|---|
| `AUTH_SECRET` / `BETTER_AUTH_SECRET` | Secret für Sitzungen (mind. 32 Zeichen, z. B. `openssl rand -base64 32`). Leer lassen: Der Container erzeugt beim ersten Start eines und speichert es in `/data/.auth-secret` | *(auto)* |
| `APP_URL` | Öffentliche Adresse der App, z. B. `https://cashflow.example.org` | `http://localhost:3000` |
| `BIND_ADDRESS` | Nur `docker-compose.yml`: Adresse, an die Port 3000 gebunden wird. `0.0.0.0` für direkten Zugriff im Netzwerk | `127.0.0.1` |
| `CASHFLOW_VERSION` | Nur `docker-compose.yml`: Image-Tag, z. B. `1.2.0` | `latest` |
| `UPDATE_CHECK` | `false` schaltet den Update-Hinweis im Admin-Bereich ab | *(an)* |
| `ALLOW_DEMO_SEED` | Erlaubt `npm run db:seed` mit `NODE_ENV=production` (nur für Tests) | *(aus)* |
| `ENABLE_BANKING_APPLICATION_ID` | Anwendungs-ID für Enable Banking (Live-PSD2) | *(Optional)* |
| `ENABLE_BANKING_PRIVATE_KEY` | Privater RSA-Schlüssel (RS256) für die Enable Banking API | *(Optional)* |
| `BANK_SYNC_MOCK` | Simulierter Sandbox-Modus mit Testkonten und -buchungen. In Entwicklung automatisch aktiv, wenn keine Live-Keys hinterlegt sind; **in Produktion nur mit `true`** | `false` |
| `TOKEN_ENCRYPTION_KEY` | Eigener Schlüssel (mind. 32 Zeichen) für die Verschlüsselung der Bank-Tokens. Ohne ihn wird das Auth-Secret verwendet. Bestehende Tokens werden beim nächsten Sync automatisch auf den neuen Schlüssel umgestellt | *(empfohlen)* |
| `TOKEN_ENCRYPTION_KEY_PREVIOUS` | Vorheriger Schlüssel (kommagetrennt) während einer Schlüsselrotation | *(leer)* |
| `CRON_SECRET` | Bearer-Token für `POST /api/cron/bank-sync` (mind. 32 Zeichen); ohne ihn ist der Endpunkt deaktiviert | *(leer)* |
| `BANK_SYNC_INTERVAL_MINUTES` | Intervall des Hintergrund-Syncs | `360` |
| `BANK_SYNC_MAX_UNATTENDED_PER_DAY` | Maximale automatische Abrufe pro Konto und Tag (höchstens 4) | `4` |
| `RATE_LIMIT_ENABLED` | IP-basiertes Rate-Limit für Anmeldung, 2FA und Passwortänderung (in der Datenbank gespeichert). In Produktion standardmäßig aktiv, `false` schaltet es ab | *(auto)* |
| `IP_ADDRESS_HEADERS` | Header, aus denen die Client-IP gelesen wird (kommagetrennt). Hinter Cloudflare z. B. `cf-connecting-ip` | `x-forwarded-for,x-real-ip` |
| `TRUSTED_PROXIES` | IPs/CIDR deines Reverse-Proxys, damit weitergereichte IP-Ketten korrekt ausgewertet werden | *(leer)* |
| `AUTO_BACKUP_ENABLED` | Automatische Datenbank-Sicherungen (`false` schaltet sie ab) | `true` |
| `BACKUP_INTERVAL_HOURS` | Abstand zwischen automatischen Sicherungen | `24` |
| `BACKUP_RETENTION_COUNT` | Anzahl aufbewahrter Sicherungen | `14` |
| `BACKUP_DIR` | Ablageort der Sicherungen | `<Datenbankordner>/backups` |
| `BACKUP_ENCRYPTION_KEY` | Verschlüsselt Sicherungen mit AES-256-GCM (mind. 32 Zeichen). Ohne Schlüssel lassen sie sich nicht wiederherstellen – sicher aufbewahren! | *(leer)* |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Schlüsselpaar für Push-Benachrichtigungen (base64url). Ohne Angabe erzeugt die App einmalig eines und speichert es in der Datenbank | *(auto)* |
| `VAPID_SUBJECT` | Kontakt für Push-Dienste (`mailto:` oder `https:`); sonst wird `APP_URL` verwendet | *(APP_URL)* |
| `TRUSTED_HOSTS` | Zusätzliche Hostnamen (kommagetrennt, z. B. `kosten.lan:3000`), die neben dem Host aus `APP_URL` für Redirects akzeptiert werden. Andere `Host`-/`X-Forwarded-Host`-Header werden ignoriert | *(leer)* |

