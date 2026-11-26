#!/bin/sh
set -e

# Secret für Sitzungen: Ist keins gesetzt, wird beim ersten Start eines erzeugt
# und unter /data gespeichert, damit es Neustarts übersteht. Ein gesetztes,
# aber zu kurzes oder aus einem Beispiel kopiertes Secret bricht den Start ab.
SECRET_FILE="${AUTH_SECRET_FILE:-/data/.auth-secret}"
SECRET="${BETTER_AUTH_SECRET:-$AUTH_SECRET}"

if [ -z "$SECRET" ] && [ "$NODE_ENV" = "production" ]; then
  if [ ! -s "$SECRET_FILE" ]; then
    mkdir -p "$(dirname "$SECRET_FILE")"
    umask 077
    head -c 48 /dev/urandom | base64 | tr -d '\n' > "$SECRET_FILE"
    echo "Kein AUTH_SECRET gesetzt: neues Secret erzeugt und in $SECRET_FILE gespeichert."
  fi
  SECRET="$(cat "$SECRET_FILE")"
  export AUTH_SECRET="$SECRET"
  export BETTER_AUTH_SECRET="$SECRET"
fi

if [ "$NODE_ENV" = "production" ]; then
  SECRET_LEN=$(printf '%s' "$SECRET" | wc -c | tr -d ' ')
  if [ "$SECRET_LEN" -lt 32 ] || \
     printf '%s' "$SECRET" | grep -qiE "bitte-aendern|lokales-entwicklungs-secret|bitte-in-env-setzen|eintragen|changeme|change-me|change_me|your-secret|dein-secret|example|beispiel"; then
    echo "[SECURITY FATAL] AUTH_SECRET bzw. BETTER_AUTH_SECRET ist zu kurz (mindestens 32 Zeichen) oder ein Platzhalter aus einem Beispiel."
    echo "Aktuelle Länge: $SECRET_LEN Zeichen (Wert wird aus Sicherheitsgründen nicht ausgegeben)."
    echo "Erzeuge eines mit 'openssl rand -base64 32' oder lasse die Variable leer, dann erzeugt die App beim ersten Start selbst eines."
    exit 1
  fi
fi

# Falls der Container als root startet (Standard bei Docker Bind-Mounts ./data:/data),
# werden /data/uploads angelegt, die Rechte für den Benutzer nextjs (1001:1001)
# gesetzt und die Root-Rechte mit su-exec dauerhaft abgegeben.
if [ "$(id -u)" = "0" ]; then
  mkdir -p /data/uploads
  chown -R nextjs:nodejs /data
  echo "Prüfe SQLite-Datenbank unter ${DATABASE_PATH:-/data/app.db} (als Benutzer nextjs)..."
  exec su-exec nextjs:nodejs node server.js
fi

mkdir -p /data/uploads
echo "Prüfe SQLite-Datenbank unter ${DATABASE_PATH:-/data/app.db}..."
exec node server.js
