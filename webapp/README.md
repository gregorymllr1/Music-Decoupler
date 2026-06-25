# Demucs Stem Studio

A local web app that uses Demucs to split songs (FLAC/MP3/WAV/…) into stems and
mix, isolate, remove, compare, and export them in the browser.

## Prerequisites
- Python 3.8+ with the `demucs` package and a working `torch` (CUDA optional; CPU works).
- **ffmpeg** on your PATH (required for decoding).
- Node 18+.

## Install
```bash
# backend (from repo root, with your demucs venv active)
cd webapp/backend && pip install -e . && pip install -e ".[dev]"
# frontend
cd ../frontend && npm install
```

## Run (development)
```bash
# starts API (:8000), worker, and Vite dev server
webapp/scripts/run-dev.sh        # or run-dev.ps1 on Windows
```
Open the Vite URL. The API is proxied at `/api`.

## Run (single-command, built UI)
```bash
webapp/scripts/run-prod.sh       # or run-prod.ps1
```
Then open http://127.0.0.1:8000.

## Tests
```bash
cd webapp/backend && python -m pytest -m "not integration"   # fast unit/API tests
cd webapp/backend && python tests/fixtures/make_clip.py       # one-time fixture
cd webapp/backend && python -m pytest -m integration          # runs real separation (slow, downloads models)
cd webapp/frontend && npm test
```

## Notes
- The worker keeps the Demucs model warm; the first job for a new model downloads weights.
- Isolation = solo a stem; removal/karaoke = mute a stem; export renders your mix server-side.
- All data lives under `webapp/data/` (gitignored).