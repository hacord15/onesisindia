#!/usr/bin/env bash
# Pre-migration / routine backup: Postgres dump + media directory + env file.
# Read-only with respect to the app, the DB and MinIO. Usage: bash scripts/backup.sh
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE="${ENV_FILE:-.env}"
if [ -f "$ENV_FILE" ]; then set -a; . "$ENV_FILE"; set +a; fi
: "${DATABASE_URI:?DATABASE_URI is required}"

STAMP="$(date +%Y%m%d-%H%M%S)"
DEST="${BACKUP_DIR:-./backups}/$STAMP"
umask 077
mkdir -p "$DEST"

echo "[1/3] Postgres dump (custom format)…"
pg_dump --format=custom --no-owner --dbname="$DATABASE_URI" --file="$DEST/db.dump"

echo "[2/3] Media directory…"
if [ -n "${MEDIA_DIR:-}" ] && [ -d "$MEDIA_DIR" ]; then
  tar -czf "$DEST/media.tar.gz" -C "$MEDIA_DIR" .
else
  echo "      (MEDIA_DIR not set or not present yet — skipped)"
fi

echo "[3/3] Env file (permissions 600; contains secrets, keep it private)…"
[ -f "$ENV_FILE" ] && cp "$ENV_FILE" "$DEST/env.backup"

( cd "$DEST" && sha256sum * > SHA256SUMS )
echo "Backup written to $DEST"
echo "NOTE: also snapshot the MinIO data dir before cutover, e.g.: tar -czf minio-data-$STAMP.tar.gz -C /path/to/minio/data ."
