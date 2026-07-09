#!/usr/bin/env sh
set -eu

BACKUP_DIR="${BACKUP_DIR:-/var/backups/yapskippr-feedback}"
CONTAINER_NAME="${CONTAINER_NAME:-yapskippr-feedback-db}"
DATABASE_NAME="${DATABASE_NAME:-yapskippr}"
DATABASE_USER="${DATABASE_USER:-yapskippr}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
TIMESTAMP="$(date +%F-%H%M%S)"
OUTPUT_FILE="$BACKUP_DIR/yapskippr-$TIMESTAMP.sql.gz"

mkdir -p "$BACKUP_DIR"

docker exec "$CONTAINER_NAME" pg_dump -U "$DATABASE_USER" "$DATABASE_NAME" | gzip > "$OUTPUT_FILE"
find "$BACKUP_DIR" -type f -name 'yapskippr-*.sql.gz' -mtime +"$RETENTION_DAYS" -delete

printf 'Created YapSkippr backup: %s\n' "$OUTPUT_FILE"
