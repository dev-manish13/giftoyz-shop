#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

[ -f .env ] || { echo "Missing server/.env. Copy .env.example to .env and fill it in."; exit 1; }
chmod 600 .env
[ -d .venv ] || python3 -m venv .venv
.venv/bin/pip install -q -r requirements.txt
exec .venv/bin/uvicorn app.main:create_app --factory --host 127.0.0.1 --port "${PORT:-8080}" --no-server-header
