# Build the SPA, then run API (serving static) + worker (Windows).
# Uses the project's venv (webapp/backend/.venv) explicitly so it works
# regardless of which Python is on PATH.
$root = Split-Path $PSScriptRoot -Parent
$venvPy  = Join-Path $root 'backend\.venv\Scripts\python.exe'
$venvUvi = Join-Path $root 'backend\.venv\Scripts\uvicorn.exe'

if (-not (Test-Path $venvPy)) {
  throw "Backend venv not found at $venvPy. Run: cd webapp/backend && py -3.13 -m venv .venv && .venv/Scripts/python.exe -m pip install -e ."
}

Push-Location "$root/frontend"; npm install; npm run build; Pop-Location

# Worker in a new window (so its logs stay visible)
Start-Process powershell -ArgumentList "-NoExit","-Command","cd '$root/backend'; '$venvPy' -m app.worker"

# API in the current window
Push-Location "$root/backend"
& $venvUvi app.main:app --host 127.0.0.1 --port 8000
Pop-Location