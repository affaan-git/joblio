#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DATA_DIR="$ROOT_DIR/.joblio-data"
BACKUP_DIR="$ROOT_DIR/backups"
STAMP="$(date +%Y%m%d-%H%M%S)"

mkdir -p "$BACKUP_DIR"

if [ ! -f "$DATA_DIR/state.json" ]; then
  echo "No state file found at $DATA_DIR/state.json"
  exit 1
fi

cp "$DATA_DIR/state.json" "$BACKUP_DIR/state-$STAMP.json"

echo "Backup created: $BACKUP_DIR/state-$STAMP.json"
