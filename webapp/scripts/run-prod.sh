#!/usr/bin/env bash
set -e
root="$(cd "$(dirname "$0")/.." && pwd)"
( cd "$root/frontend" && npm install && npm run build )
( cd "$root/backend" && python -m app.worker ) &
( cd "$root/backend" && uvicorn app.main:app --host 127.0.0.1 --port 8000 )