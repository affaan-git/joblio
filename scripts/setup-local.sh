#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ -z "${JOBLIO_API_TOKEN:-}" ]]; then
  if command -v openssl >/dev/null 2>&1; then
    export JOBLIO_API_TOKEN="$(openssl rand -hex 24)"
  else
    export JOBLIO_API_TOKEN="joblio-$(date +%s)-$RANDOM"
  fi
  echo "Generated JOBLIO_API_TOKEN for this shell session."
fi

export JOBLIO_STRICT_MODE="${JOBLIO_STRICT_MODE:-1}"
export HOST="${HOST:-127.0.0.1}"
export PORT="${PORT:-8787}"

node ./scripts/preflight.js

echo
echo "Starting Joblio at http://${HOST}:${PORT}"
echo "Set this token in UI via Data -> Set API token"
echo "Token: ${JOBLIO_API_TOKEN}"
echo

exec node server.js
