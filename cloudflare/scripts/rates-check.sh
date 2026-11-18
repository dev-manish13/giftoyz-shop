#!/usr/bin/env bash
# Starts a live NCM price refresh as the admin and follows it to the end. Prints progress only.
set -euo pipefail
cd "$(dirname "$0")/.."
KEY=$(grep '^ADMIN_API_KEY=' ../server/.env | cut -d= -f2- | tr -d '"')
BASE=https://giftoyz.manishkandel-co.workers.dev
curl -s -X POST "$BASE/api/admin/rates/sync" -H "Authorization: Bearer $KEY"; echo
for i in $(seq 1 60); do
  sleep 4
  OUT=$(curl -s "$BASE/api/admin/rates" -H "Authorization: Bearer $KEY")
  RUN=$(echo "$OUT" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["running"], d.get("progress"))')
  echo "$RUN"
  case "$RUN" in False*) echo "$OUT" | python3 -c 'import json,sys; s=json.load(sys.stdin)["last_sync"]; print({k: s[k] for k in ("origin","checked","updated","failed_count","failed")}, "changed:", len(s["changed"]))'; exit 0;; esac
done
