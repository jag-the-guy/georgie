#!/usr/bin/env bash
# Downloads a full backup (database + every uploaded image) from your live site.
#
#   ADMIN_KEY='your-secret-key' ./scripts/download-backup.sh https://your-site.up.railway.app [folder]
#
# The key is read from the environment (not typed as an argument) so it stays out of your shell history.
set -euo pipefail

SITE="${1:-}"
OUT="${2:-$HOME/georgie-backups}"
if [ -z "$SITE" ] || [ -z "${ADMIN_KEY:-}" ]; then
  echo "Usage: ADMIN_KEY='...' $0 https://your-site.up.railway.app [folder]" >&2
  exit 1
fi

mkdir -p "$OUT"
FILE="$OUT/georgie-backup-$(date +%Y-%m-%d-%H%M).tar.gz"

curl --fail --silent --show-error -H "Authorization: Bearer $ADMIN_KEY" "${SITE%/}/api/admin/backup" -o "$FILE"

# Make sure what we got is a real, readable archive that contains the database.
tar -tzf "$FILE" | grep -qx 'app.db' || { echo "Backup looks wrong, deleting it." >&2; rm -f "$FILE"; exit 1; }
echo "Saved $(du -h "$FILE" | cut -f1) backup to: $FILE"
