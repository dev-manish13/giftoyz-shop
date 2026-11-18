#!/usr/bin/env bash
# Asks NCM to send status updates to https://giftoyz.com/api/ncm/webhook. Prints only the result.
set -euo pipefail
cd "$(dirname "$0")/.."
KEY=$(grep '^ADMIN_API_KEY=' ../server/.env | cut -d= -f2- | tr -d '"')
curl -sS -X POST https://giftoyz.com/api/admin/ncm/webhook -H "Authorization: Bearer $KEY"; echo
