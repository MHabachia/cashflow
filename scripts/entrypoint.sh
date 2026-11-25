#!/bin/sh
set -e

# Strikte Sicherheitsprüfung für AUTH_SECRET in Produktion
if [ "$NODE_ENV" = "production" ]; then
  SECRET="${BETTER_AUTH_SECRET:-$AUTH_SECRET}"
  SECRET_LEN=$(echo -n "$SECRET" | wc -c | tr -d ' ')
  if [ -z "$SECRET" ] || \
     echo "$SECRET" | grep -qE "bitte-aendern|lokales-entwicklungs-secret|bitte-in-env-setzen" || \
     [ "$SECRET_LEN" -lt 32 ]; then
    echo "[SECURITY FATAL] In Produktion muss ein sicheres AUTH_SECRET bzw. BETTER_AUTH_SECRET (mindestens 32 Zeichen) gesetzt sein!"
    echo "Aktuelle Länge: $SECRET_LEN Zeichen (Wert wird aus Sicherheitsgründen nicht ausgegeben)."
    echo "Bitte generiere ein sicheres Secret mit 'openssl rand -base64 32' und hinterlege es in der Umgebung."
    exit 1
  fi
fi

# Falls der Container als root startet (Standard bei Docker Bind-Mounts ./data:/data),
# erstellen wir /data/uploads, setzen die Berechtigungen für den Non-Root-User nextjs (1001:1001)
# und droppen die Root-Rechte sofort dauerhaft mit su-exec!
if [ "$(id -u)" = "0" ]; then
  mkdir -p /data/uploads
  chown -R nextjs:nodejs /data
  echo "Prüfe SQLite-Datenbank unter ${DATABASE_PATH:-/data/app.db} (als Non-Root User nextjs)..."
  exec su-exec nextjs:nodejs node server.js
fi

mkdir -p /data/uploads
echo "Prüfe SQLite-Datenbank unter ${DATABASE_PATH:-/data/app.db}..."
exec node server.js
