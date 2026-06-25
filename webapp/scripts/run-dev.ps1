# Run backend API, worker, and frontend dev server together (Windows).
# Uses the project's venv (webapp/backend/.venv) explicitly.
$root = Split-Path $PSScriptRoot -Parent
$venvPy  = Join-Path $root 'backend\.venv\Scripts\python.exe'
$venvUvi = Join-Path $root 'backend\.venv\Scripts\uvicorn.exe'

if (-not (Test-Path $venvPy)) {
  throw "Backend venv not found at $venvPy. Run: cd webapp/backend && py -3.13 -m venv .venv && .venv/Scripts/python.exe -m pip install -e ."
}

Start-Process powershell -ArgumentList "-NoExit","-Command","cd '$root/backend'; '$venvUvi' app.main:app --reload --port 8000"
Start-Process powershell -ArgumentList "-NoExit","-Command","cd '$root/backend'; '$venvPy' -m app.worker"
Start-Process powershell -ArgumentList "-NoExit","-Command","cd '$root/frontend'; npm run dev"