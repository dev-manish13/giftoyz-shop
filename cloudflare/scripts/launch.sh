#!/usr/bin/env bash
# One-time launch: tests, settings import, QR images to R2, webhook secret, deploy to giftoyz.com. Prints no secrets.
set -uo pipefail
cd "$(dirname "$0")/.."
step() { echo; echo "== $1"; }
step "Tests"
npm test > .wrangler/test.log 2>&1 || { grep -nE "FAIL|AssertionError" .wrangler/test.log | head; exit 1; }
grep -E "Tests " .wrangler/test.log
step "Copy settings"
npx wrangler d1 execute giftoyz-db --remote --file .wrangler/import.sql < /dev/null 2>&1 | grep -E "success|rows_written|rror" | head -3
step "Upload QR codes"
for f in q-1f54c0d72790.png q-bfe2d2ff669d.png; do
  npx wrangler r2 object put "giftoyz-media/products/$f" --file "../media/products/$f" --content-type image/png --cache-control "public, max-age=31536000, immutable" --remote 2>&1 | tail -1
done
step "Webhook secret"
if npx wrangler secret list 2>/dev/null | grep -q NCM_WEBHOOK_SECRET; then
  echo "already set"
else
  openssl rand -hex 24 | tr -d '\n' | npx wrangler secret put NCM_WEBHOOK_SECRET 2>&1 | tail -1
fi
step "Deploy to giftoyz.com"
npm run deploy 2>&1 | tail -12
