# Run backend API, worker, and frontend dev server together (Windows).
$root = Split-Path $PSScriptRoot -Parent
Start-Process powershell -ArgumentList "-NoExit","-Command","cd '$root/backend'; uvicorn app.main:app --reload --port 8000"
Start-Process powershell -ArgumentList "-NoExit","-Command","cd '$root/backend'; python -m app.worker"
Start-Process powershell -ArgumentList "-NoExit","-Command","cd '$root/frontend'; npm run dev"