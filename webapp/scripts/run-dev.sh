#!/usr/bin/env bash
set -e
root="$(cd "$(dirname "$0")/.." && pwd)"
( cd "$root/backend" && uvicorn app.main:app --reload --port 8000 ) &
( cd "$root/backend" && python -m app.worker ) &
( cd "$root/frontend" && npm run dev ) &
wait