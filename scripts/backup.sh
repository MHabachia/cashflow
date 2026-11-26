#!/bin/sh
set -e

DATA_DIR="${1:-./data}"
BACKUP_DIR="${2:-./backups}"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")

mkdir -p "$BACKUP_DIR"

if [ -f "$DATA_DIR/app.db" ]; then
  sqlite3 "$DATA_DIR/app.db" ".backup '$BACKUP_DIR/app_${TIMESTAMP}.db'"
  echo "SQLite-Backup erstellt: $BACKUP_DIR/app_${TIMESTAMP}.db"
fi

if [ -d "$DATA_DIR/uploads" ]; then
  tar -czf "$BACKUP_DIR/uploads_${TIMESTAMP}.tar.gz" -C "$DATA_DIR" uploads
  echo "Uploads-Archiv erstellt: $BACKUP_DIR/uploads_${TIMESTAMP}.tar.gz"
fi

# Automatisch erzeugtes Sitzungs-Secret (nur vorhanden, wenn AUTH_SECRET nicht gesetzt ist)
if [ -f "$DATA_DIR/.auth-secret" ]; then
  (umask 077 && cp "$DATA_DIR/.auth-secret" "$BACKUP_DIR/auth-secret_${TIMESTAMP}")
  echo "Secret gesichert: $BACKUP_DIR/auth-secret_${TIMESTAMP} (vertraulich aufbewahren)"
fi

echo "Hinweis: Diese Sicherung ist nicht verschlüsselt. Bewahre den Ordner $BACKUP_DIR geschützt auf."

