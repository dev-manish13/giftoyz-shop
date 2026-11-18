#!/usr/bin/env bash
# Uploads one photo to the live test site as the admin, prints only the result JSON, then deletes the files it made.
set -euo pipefail
cd "$(dirname "$0")/.."
KEY=$(grep '^ADMIN_API_KEY=' ../server/.env | cut -d= -f2- | tr -d '"')
BASE=${BASE:?set BASE to the workers.dev test URL}
OUT=$(curl -s -X POST "$BASE/api/admin/media?kind=photo&alt=check" -H "Authorization: Bearer $KEY" --data-binary @"$1")
echo "$OUT"
SRC=$(echo "$OUT" | sed -n 's/.*"src":"\/media\/products\/\([a-z0-9-]*\)".*/\1/p')
[ -n "$SRC" ] || exit 1
curl -s -o /dev/null -w "served 1200.avif: %{http_code} %{content_type} %{size_download} bytes\n" "$BASE/media/products/$SRC-1200.avif"
for w in 600 1200; do for f in avif webp jpg; do npx wrangler r2 object delete "giftoyz-media/products/$SRC-$w.$f" --remote >/dev/null 2>&1; done; done
echo "cleaned up $SRC"
