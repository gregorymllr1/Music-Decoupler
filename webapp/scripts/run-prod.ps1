# Build the SPA, then run API (serving static) + worker (Windows).
$root = Split-Path $PSScriptRoot -Parent
Push-Location "$root/frontend"; npm install; npm run build; Pop-Location
Start-Process powershell -ArgumentList "-NoExit","-Command","cd '$root/backend'; python -m app.worker"
Push-Location "$root/backend"; uvicorn app.main:app --host 127.0.0.1 --port 8000; Pop-Location