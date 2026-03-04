#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DATA_DIR="$ROOT_DIR/.joblio-data"
BACKUP_DIR="$ROOT_DIR/backups"
STAMP="$(date +%Y%m%d-%H%M%S)"

mkdir -p "$BACKUP_DIR"

if [ ! -d "$DATA_DIR" ]; then
  echo "No data directory found at $DATA_DIR"
  exit 1
fi

ARCHIVE="$BACKUP_DIR/joblio-data-$STAMP.tar.gz"
tar -C "$ROOT_DIR" -czf "$ARCHIVE" .joblio-data

echo "Backup created: $ARCHIVE"
