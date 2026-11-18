#!/usr/bin/env bash
# Daily database backup, keeps the last 30. Cron: 30 3 * * * /srv/giftoyz/server/deploy/backup.sh
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p backups
sqlite3 data/ncm.sqlite3 ".backup 'backups/giftoyz-$(date +%F).sqlite3'"
ls -1t backups/giftoyz-*.sqlite3 | tail -n +31 | xargs -r rm --
