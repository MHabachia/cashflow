# Installation und Betrieb

## Mit Docker Compose

Das fertige Image gibt es für `linux/amd64` und `linux/arm64` unter `ghcr.io/mhabachia/cashflow`.

1. Lege einen Ordner an und darin eine `.env`:

   ```env
   APP_URL=https://cashflow.example.org
   # Empfohlen: eigene Schlüssel, jeweils mit `openssl rand -base64 32` erzeugen
   TOKEN_ENCRYPTION_KEY=
   BACKUP_ENCRYPTION_KEY=
   # Nur nötig, wenn ein externer Cron den Bank-Abruf anstößt
   CRON_SECRET=
   # AUTH_SECRET leer lassen: Der Container erzeugt beim ersten Start eines
   # und speichert es in ./data/.auth-secret
   AUTH_SECRET=
   ```

2. Lege daneben eine `docker-compose.yml` an:

   ```yaml
   services:
     cashflow:
       image: ghcr.io/mhabachia/cashflow:1.2.1
       container_name: cashflow-app
       restart: unless-stopped
       ports:
         - "127.0.0.1:3000:3000"
       env_file: .env
       environment:
         - NODE_ENV=production
         - DATABASE_PATH=/data/app.db
         - UPLOADS_DIR=/data/uploads
         - BETTER_AUTH_URL=${APP_URL}
         - NEXT_PUBLIC_APP_URL=${APP_URL}
       volumes:
         - ./data:/data
       security_opt:
         - no-new-privileges:true
       cap_drop: [ALL]
       cap_add: [CHOWN, DAC_OVERRIDE, FOWNER, SETUID, SETGID]
   ```

3. Starten:

   ```bash
   docker compose up -d
   ```

4. `https://<deine-adresse>/register` öffnen und das erste Konto anlegen. Es wird Admin; Standardkategorien und Vorlagen werden angelegt.

Alternativ aus dem Repository bauen: `cp .env.example .env`, Werte anpassen, `docker compose up -d --build`. Die Datenbank liegt unter `./data/app.db`, Belegfotos unter `./data/uploads`. Die Rechte von `./data` setzt der Container beim Start selbst.

### Port und Rate-Limit

Der Port ist standardmäßig nur an `127.0.0.1` gebunden, also für einen Reverse Proxy auf demselben Rechner. Wer ohne Proxy direkt im Heimnetz zugreifen will, setzt `BIND_ADDRESS=0.0.0.0` (mitgelieferte Compose-Datei) bzw. `"3000:3000"` und **leert `IP_ADDRESS_HEADERS`**. Sonst kann ein Client über einen gefälschten `X-Forwarded-For`-Header eine beliebige IP vortäuschen und das Rate-Limit umgehen. Hinter einem Proxy gehört dessen Adresse in `TRUSTED_PROXIES`.

### Härtung

Die Compose-Beispiele setzen `no-new-privileges` und entziehen alle Linux-Fähigkeiten bis auf die, die der Entrypoint zum Anpassen der Dateirechte von `/data` und zum Wechsel auf den Benutzer `nextjs` braucht. Ein schreibgeschütztes Dateisystem (`read_only: true`) ist nicht vorgesehen, weil Next.js zur Laufzeit in `.next/cache` schreibt.

## Hinter einem Reverse Proxy

Für die Installation als App, Passkeys und sichere Cookies muss Cashflow über HTTPS erreichbar sein. Ein Reverse Proxy (Nginx, Traefik, Caddy, Nginx Proxy Manager) terminiert TLS und leitet an `http://127.0.0.1:3000` weiter. In der `.env` steht dann die öffentliche Adresse:

```env
APP_URL=https://cashflow.example.org
```

## Über einen Cloudflare Tunnel

Ohne geöffnete Ports, die App ist nur über den Tunnel erreichbar:

1. Im Cloudflare Zero Trust Dashboard unter **Networks → Tunnels** einen Tunnel anlegen und das Token kopieren.
2. `docker-compose.yml`:

   ```yaml
   services:
     cashflow:
       image: ghcr.io/mhabachia/cashflow:1.2.1
       container_name: cashflow-app
       restart: unless-stopped
       env_file: .env
       environment:
         - NODE_ENV=production
         - DATABASE_PATH=/data/app.db
         - UPLOADS_DIR=/data/uploads
         - BETTER_AUTH_URL=${APP_URL}
         - NEXT_PUBLIC_APP_URL=${APP_URL}
         # Cloudflare setzt die echte Client-IP in diesem Header
         - IP_ADDRESS_HEADERS=cf-connecting-ip
       volumes:
         - ./data:/data

     cloudflared:
       image: cloudflare/cloudflared:2026.11.2
       container_name: cashflow-cloudflared
       restart: unless-stopped
       command: tunnel --no-autoupdate run --token ${CLOUDFLARE_TUNNEL_TOKEN}
       depends_on:
         - cashflow
   ```

3. Im Tunnel als **Public Hostname** die Domain mit dem Ziel `http://cashflow:3000` eintragen.
4. In der `.env` `APP_URL=https://…` und `CLOUDFLARE_TUNNEL_TOKEN=…` setzen, dann `docker compose up -d`.

## Aktualisieren

1. **Vorher sichern** (siehe [Sicherung](backup.md)). Migrationen laufen beim Start automatisch und lassen sich nicht zurückdrehen.
2. Den Changelog der neuen Version lesen, besonders Hinweise unter „Changed“ und „Security“.
3. In Produktion eine feste Version verwenden (`ghcr.io/mhabachia/cashflow:1.2.1` bzw. `CASHFLOW_VERSION=1.2.1`) statt `latest` und bewusst hochziehen:

   ```bash
   docker compose pull && docker compose up -d
   ```

## Als App installieren (PWA)

Die Anwendung lässt sich ohne App-Store aus dem Browser installieren und läuft dann in einem eigenen Fenster:

- **Android (Chrome / Edge / Firefox):** Öffne die Webseite, tippe im Browser-Menü (⋮) auf **„App installieren“** oder **„Zum Startbildschirm hinzufügen“**.
- **iOS / iPadOS (Safari):** Öffne die Webseite, tippe auf das **Teilen-Symbol** und wähle **„Zum Home-Bildschirm“**.
- **Desktop (Chrome / Edge / Safari):** Klicke rechts in der Adressleiste auf das **App-Installations-Icon** bzw. wähle *„Zum Dock hinzufügen“*.
