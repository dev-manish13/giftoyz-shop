#!/usr/bin/env bash
# Copies NCM secrets from server/.env into the Worker's secret store without printing them.
set -euo pipefail
cd "$(dirname "$0")/.."
for name in NCM_API_TOKEN NCM_WEBHOOK_SECRET; do
  value=$(grep "^${name}=" ../server/.env | cut -d= -f2- | tr -d '"' || true)
  if [ -n "$value" ]; then
    printf '%s' "$value" | npx wrangler secret put "$name" >/dev/null 2>&1 && echo "$name set" || echo "$name FAILED"
  else
    echo "$name not in server/.env, skipped"
  fi
done
