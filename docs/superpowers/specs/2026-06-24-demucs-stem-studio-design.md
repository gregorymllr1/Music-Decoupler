# Demucs Stem Studio — Design Spec

**Date:** 2026-06-24
**Status:** Draft for review
**Author:** brainstormed with Claude Code

A personal, local web application that wraps the Demucs v4 source-separation engine
in a full "stem studio": upload a song (FLAC/MP3/WAV/…), separate it into its
components (vocals, drums, bass, other — and optionally guitar/piano), then
isolate, remove, mix, compare, and export stems through a browser UI.

---

## 1. Goals & Non-Goals

### Goals
- Separate FLAC and MP3 (and other common formats) into all available stems.
- First-class **vocal isolation** (solo vocals) and **vocal removal** (karaoke: mute
  vocals, keep the rest) — and the same for any individual instrument.
- A rich, interactive **studio**: per-stem multitrack player with mute/solo/volume,
  synced waveforms, A/B comparison, custom mixdown export, batch processing, and a
  job-history library.
- Run entirely **locally** for a single user. No accounts, no cloud, no external
  services to operate.
- Auto-detect a CUDA GPU and use it when present; fall back to CPU transparently.

### Non-Goals (YAGNI — explicitly out of scope)
- Authentication, multi-user, or any cloud/hosted deployment.
- Distributed task queues (Redis/Celery) or horizontal scaling.
- Real-time / streaming separation (jobs are batch, file-in/files-out).
- Model **training** or fine-tuning (we consume pretrained models only).
- Advanced DSP beyond gain/mute/solo/pan (no EQ, no time-stretch, no pitch shift).
- Mobile-native apps or payment/billing.

### Success criteria
- Drop in a 4-minute FLAC or MP3, get correct, full-quality stems back with a live
  progress bar, and play them back in-browser as a synced multitrack within one click.
- Muting the `vocals` stem yields a clean instrumental; soloing it yields clean
  vocals. Same for every other stem.
- Export a custom combination of stems (e.g. "everything except vocals") as a single
  MP3/FLAC/WAV at full resolution.
- The web UI stays responsive while a separation runs, and a closed/reopened browser
  reconnects to an in-progress or finished job.

---

## 2. The Engine We're Wrapping

Demucs already does the hard part. The app is a UI + orchestration layer over
`demucs.api`:

```python
import demucs.api
separator = demucs.api.Separator(model="htdemucs", device="cuda", callback=cb)
origin, separated = separator.separate_audio_file(path)  # separated: {stem: Tensor}
demucs.api.save_audio(source, out_path, samplerate=separator.samplerate)
```

**Models available** (selectable in the UI):

| Model | Stems | Notes |
|-------|-------|-------|
| `htdemucs` (default) | drums, bass, vocals, other | Fast, strong quality |
| `htdemucs_ft` | drums, bass, vocals, other | Fine-tuned, ~4× slower, slightly better |
| `htdemucs_6s` | + guitar, piano | 6 stems; piano stem is weak (documented) |
| `hdemucs_mmi` | drums, bass, vocals, other | Hybrid Demucs v3 retrained |
| `mdx`, `mdx_extra`, `mdx_q`, `mdx_extra_q` | drums, bass, vocals, other | Alternatives; `_q` = quantized/smaller |

**Key engine facts that shape the design:**
- Separation is CPU/GPU-bound and slow (~1.5× track length on CPU; much faster on
  GPU). It must run off the request path, in a separate process.
- The `Separator(callback=...)` hook fires per segment with a dict containing
  `model_idx_in_bag`, `shift_idx`, `segment_offset`, `audio_length`, `models`, and
  `state` ("start"/"end") — enough to compute a real progress fraction.
- Input decoding on Windows relies on **ffmpeg** (torchaudio support is limited there).
  ffmpeg is therefore a hard runtime dependency and must be checked at startup.
- `demucs.api.save_audio` writes `.wav` (int16/int24/float32) and `.mp3` (bitrate +
  preset). **FLAC output** is written via `soundfile` (already a Windows dependency).
- We always separate into **all** stems for a job; "isolation" and "removal" are then
  pure UI/mixdown operations (solo = isolate, mute = remove). This is simpler and more
  flexible than Demucs' `--two-stems` mode and avoids re-running separation to change
  which stems you want.

---

## 3. Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser — React + TypeScript SPA                                 │
│  Upload ▸ Job Dashboard ▸ Studio (mixer/waveforms/A-B) ▸ Library  │
└───────────────┬───────────────────────────▲──────────────────────┘
                │ REST (upload, enqueue,      │ SSE (live progress)
                │ list, download, mixdown)    │
┌───────────────▼───────────────────────────┴──────────────────────┐
│  FastAPI app (web process) — light, never imports Torch           │
│  • POST /api/jobs            • GET /api/jobs, /api/jobs/{id}       │
│  • GET  /api/jobs/{id}/events (SSE)                                │
│  • GET  /api/jobs/{id}/stems/{stem}                               │
│  • POST /api/jobs/{id}/mixdown                                    │
│  • GET  /api/health  • GET /api/models                            │
└───────────────┬───────────────────────────▲──────────────────────┘
                │ SQLite (job queue + history, WAL mode)            │
┌───────────────▼───────────────────────────┴──────────────────────┐
│  Worker process (separate, long-lived) — owns all Torch/Demucs    │
│  • Loads Demucs model(s) once, keeps them warm (LRU cache)        │
│  • Atomically claims queued jobs from SQLite                      │
│  • Runs separation; callback → progress written to job row        │
│  • Encodes stems to storage; marks job done / failed              │
└───────────────┬───────────────────────────────────────────────────┘
                │
┌───────────────▼───────────────────────────────────────────────────┐
│  Local filesystem storage (gitignored)                            │
│  data/app.db                                                      │
│  data/uploads/{job_id}/source.<ext>                              │
│  data/stems/{job_id}/{stem}.<wav|flac|mp3>                       │
│  data/mixdowns/{job_id}/{name}.<wav|flac|mp3>                    │
└───────────────────────────────────────────────────────────────────┘
```

### Why this shape
- **Separate worker process** isolates CUDA/Torch memory and any native crash from the
  web server, keeps the model warm across jobs, and means restarting the API never
  interrupts a running separation.
- **SQLite in WAL mode** is the entire IPC + persistence layer — no Redis, no message
  broker. WAL lets the worker write while the API reads concurrently.
- **FastAPI imports no Torch**, so it boots instantly and stays responsive under load.

### Components (each independently understandable & testable)

1. **`core/`** — shared contract imported by both API and worker so neither depends on
   the other:
   - `db.py` — SQLite connection factory + schema migration (idempotent `CREATE TABLE`).
   - `jobs.py` — the job store: create, list, get, atomic-claim, update-progress,
     finish, fail, delete. **Single source of truth for job state.**
   - `schemas.py` — Pydantic models (JobCreate, JobOut, MixdownRequest, etc.).
   - `paths.py` — deterministic storage path helpers.
   - `config.py` — Pydantic Settings (storage dir, max upload size, default model/
     format, port, retention).
2. **`api/` (FastAPI)** — HTTP boundary only: upload validation, enqueue, list/get,
   SSE relay, file serving, mixdown trigger. No ML imports.
3. **`worker/`** — all Torch/Demucs lives here:
   - `engine.py` — `Separator` wrapper: device auto-detect, model LRU cache, run one job.
   - `progress.py` — pure function mapping a callback dict → `(fraction, stage_label)`.
   - `encode.py` — write stems & mixdowns to WAV/FLAC/MP3.
   - `__main__.py` — the claim→run→finish loop.
4. **`web/` (React SPA)** — four screens + the Web Audio studio engine.

---

## 4. Data Model (SQLite)

```sql
CREATE TABLE jobs (
  id              TEXT PRIMARY KEY,        -- uuid4
  batch_id        TEXT,                    -- groups multi-file uploads (nullable)
  created_at      TEXT NOT NULL,           -- ISO-8601 UTC
  updated_at      TEXT NOT NULL,
  status          TEXT NOT NULL,           -- queued|running|done|failed|canceled
  attempts        INTEGER NOT NULL DEFAULT 0,

  source_filename TEXT NOT NULL,           -- original name, for display
  source_path     TEXT NOT NULL,           -- stored upload path
  source_format   TEXT,                    -- flac|mp3|wav|...
  source_duration REAL,                    -- seconds
  source_bytes    INTEGER,

  model           TEXT NOT NULL,           -- e.g. htdemucs
  output_format   TEXT NOT NULL,           -- wav|flac|mp3
  output_bitrate  INTEGER,                 -- mp3 only (kbps)
  output_bitdepth INTEGER,                 -- wav only (16|24|32-float flag)
  requested_stems TEXT,                    -- JSON array; null = all stems

  device_used     TEXT,                    -- cuda|cpu (set when run starts)
  progress        REAL NOT NULL DEFAULT 0, -- 0.0 .. 1.0
  progress_stage  TEXT,                    -- "model 2/4", "shift 1/2", etc.

  stems           TEXT,                    -- JSON {stem: relative_path} when done
  error_message   TEXT
);

CREATE INDEX idx_jobs_status  ON jobs(status, created_at);
CREATE INDEX idx_jobs_batch   ON jobs(batch_id);

CREATE TABLE mixdowns (
  id          TEXT PRIMARY KEY,
  job_id      TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,               -- user label, e.g. "instrumental"
  spec        TEXT NOT NULL,               -- JSON: [{stem, gain, muted}], format
  path        TEXT NOT NULL,
  format      TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
```

### Job lifecycle

```
        upload+validate                  worker claims                 success
 (none) ───────────────▶ queued ─────────────────────────▶ running ───────────▶ done
                            │  ▲                                │
                    cancel  │  │ re-queue (attempts<MAX)        │ error / crash
                            ▼  │                                ▼
                         canceled                            failed
```

**Atomic claim** (prevents double-processing even though there's one worker today):
```sql
UPDATE jobs SET status='running', device_used=?, updated_at=?
WHERE id = (SELECT id FROM jobs WHERE status='queued'
            ORDER BY created_at LIMIT 1)
  AND status='queued'
RETURNING *;
```

**Crash recovery:** on worker startup, any job stuck in `running` is re-queued if
`attempts < MAX_ATTEMPTS` (default 1 retry), else marked `failed` with an explanatory
message. This handles a worker killed mid-job.

---

## 5. API Surface

All under `/api`. JSON in/out except uploads (multipart) and downloads (binary).

| Method | Path | Purpose |
|--------|------|---------|
| GET  | `/health` | ffmpeg present, device, worker heartbeat, db ok |
| GET  | `/models` | available models + their stem lists (for the picker) |
| POST | `/jobs` | multipart upload + params → validate → enqueue → `JobOut` |
| GET  | `/jobs` | list/paginate/filter (status, batch) for dashboard & library |
| GET  | `/jobs/{id}` | one job (status, progress, stems) |
| GET  | `/jobs/{id}/events` | **SSE** stream of progress/status until terminal |
| GET  | `/jobs/{id}/stems/{stem}` | stream a stem file (range requests for the player) |
| POST | `/jobs/{id}/mixdown` | render selected stems+gains to a file → `MixdownOut` |
| GET  | `/mixdowns/{id}/download` | download a rendered mixdown |
| DELETE | `/jobs/{id}` | delete job row + all its files |

### Upload request (`POST /jobs`) fields
`file` (binary), `model` (default `htdemucs`), `output_format` (`wav|flac|mp3`),
`output_bitrate` (mp3), `output_bitdepth` (wav), `stems` (optional subset to keep).

### SSE event shape
The API **polls the job row** (~400 ms) and emits on change — no cross-process pub/sub
needed:
```
event: progress
data: {"status":"running","progress":0.42,"stage":"model 2/4","device":"cuda"}

event: done
data: {"status":"done","stems":{"vocals":"...","drums":"..."}}

event: error
data: {"status":"failed","message":"CUDA out of memory; retried on CPU then failed"}
```
The stream closes once a terminal event (`done`/`error`/`canceled`) is sent. Reconnect
is by job id, so a closed browser simply re-opens the stream and gets current state.

### Mixdown request
```json
{ "name": "instrumental",
  "format": "mp3", "bitrate": 320,
  "tracks": [ {"stem":"vocals","gain":0.0,"muted":true},
              {"stem":"drums","gain":1.0,"muted":false}, ... ] }
```
Server sums the selected stem buffers with per-stem linear gain, applies the same
clip-safe rescaling Demucs uses, encodes to the chosen format, and returns a download
handle. **Export is server-side** (full resolution, any format); the live mixer is
client-side Web Audio.

---

## 6. Worker Design

### Loop (`worker/__main__.py`)
```
recover_stuck_jobs()
loop:
    job = jobs.claim_next(device=detect_device())
    if not job: sleep(0.5); continue
    try:
        run_separation(job)      # engine.py, with progress callback
        encode_stems(job)        # encode.py
        jobs.finish(job, stems)
    except Exception as e:
        jobs.fail_or_requeue(job, e)
```

### Device auto-detection & OOM resilience (`engine.py`)
- Device = `cuda` if `torch.cuda.is_available()` else `cpu`. Recorded as `device_used`.
- On a CUDA `RuntimeError: out of memory`: empty cache, **reduce `segment`** via
  `separator.update_parameter(segment=…)` and retry; after N reductions, fall back to
  `device="cpu"` and retry once. The final `device_used`/`error_message` reflect what
  happened.
- **Model LRU cache:** keep the most-recently-used `Separator` instances warm (default
  cache size 1–2). Switching models loads on demand; repeat jobs on the same model pay
  zero reload cost.

### Progress mapping (`progress.py`, pure & unit-tested)
Given the callback dict, overall fraction ≈
`(model_idx_in_bag + segment_offset/audio_length) / models`, further divided across
`shifts` when used. Emits a human label like `"model 2/4"`. Pure function → trivially
testable without running the model.

### Encoding (`encode.py`)
- `wav` → `demucs.api.save_audio` (int16 default; int24 / float32 by `output_bitdepth`).
- `mp3` → `demucs.api.save_audio` with `bitrate` (+ quality preset).
- `flac` → `soundfile.write(..., format="FLAC")` at the model samplerate (44.1 kHz).
- Mixdown: load chosen stems, apply gains, sum, clip-safe rescale, encode as above.

---

## 7. Frontend — Studio UX

Stack: **React + TypeScript + Vite**, Web Audio API for the engine, **wavesurfer.js v7**
for waveform rendering only. State via lightweight store (Zustand). REST client + an
SSE hook.

### Screens
1. **Upload** — drag-drop one or many files; pick model (with stem-list preview),
   output format/quality, and optional stem subset; submit → creates job(s).
2. **Job Dashboard** — live cards for active/queued jobs with progress bars (SSE),
   stage label, device badge, cancel button; batch groups shown together.
3. **Studio** — the core experience (below).
4. **Library** — searchable/filterable history of finished jobs; reopen in studio,
   re-download stems, export new mixdowns, delete.

### Studio layout
```
┌──────────────────────────────────────────────────────────────────────┐
│  ◀ track title            [A/B: Original | Mix]      model · device     │
├──────────────────────────────────────────────────────────────────────┤
│  vocals   ▌▆▂▅▇▂▅  waveform ───────────────────  [S][M]  ──●── vol 0dB │
│  drums    ▌▇▃▆▂▇▅  waveform ───────────────────  [S][M]  ──●── vol 0dB │
│  bass     ▌▂▅▃▆▂▃  waveform ───────────────────  [S][M]  ──●── vol 0dB │
│  other    ▌▅▆▂▇▃▅  waveform ───────────────────  [S][M]  ──●── vol 0dB │
│  (guitar/piano rows appear for htdemucs_6s)                            │
├──────────────────────────────────────────────────────────────────────┤
│  ⏮  ⏯  ⏹   00:42 / 03:58   ├─────●──────────────┤   🔁 loop   master ──●─ │
│                              [ Export mixdown ▾  format: MP3 320 ]      │
└──────────────────────────────────────────────────────────────────────┘
```

### Web Audio engine (`studio/useStudioEngine.ts`)
- One shared `AudioContext`. Each stem decoded to an `AudioBuffer`; per-stem
  `AudioBufferSourceNode → GainNode → masterGain → destination`.
- **Sample-accurate sync:** all sources `start(0, offset)` from the same context time,
  so tracks never drift (one transport, not N independent players).
- **Solo/Mute:** solo isolates a stem (the "isolation" requirement); mute removes it
  (the "vocal removal"/karaoke requirement). Multiple solos allowed.
- **Volume:** per-stem and master gain; smooth ramps to avoid clicks.
- **Seek/transport:** play/pause/stop, scrub, optional loop region.
- **A/B comparison:** instantly toggle between the **original mixture** (decoded as a
  hidden extra track) and the **current stem mix**, at matched loudness — to judge
  separation quality and your mix against the source.
- Waveforms (wavesurfer) render from the same decoded peaks and follow the transport
  cursor; they are visual only and never drive playback.

### Export
"Export mixdown" sends the current per-stem gain/mute state + chosen format to
`POST /jobs/{id}/mixdown`; the server renders at full resolution and the file downloads.
Presets offered: **Instrumental** (mute vocals), **Acapella** (solo vocals), **Custom**.

---

## 8. Error Handling & Edge Cases

| Situation | Handling |
|-----------|----------|
| Unsupported / undecodable file | Probe with ffmpeg/torchaudio at upload; reject `415` with a clear message before a job is created |
| File too large | Configurable `MAX_UPLOAD_BYTES` (default 200 MB) → `413` |
| Corrupt audio passes probe but fails mid-run | Job → `failed` with the decoder error surfaced in the UI |
| CUDA out of memory | Reduce `segment` → retry → CPU fallback; record what happened |
| Worker killed mid-job | Startup recovery re-queues (≤ `MAX_ATTEMPTS`) or marks failed |
| ffmpeg missing | `/health` fails loudly; UI shows a setup banner with install guidance |
| Disk full while writing stems | Caught → job `failed`, partial files cleaned up |
| Unicode / spaces / very long filenames | Store sanitized path; keep original name for display only |
| Browser closed during a job | Job continues server-side; reopening reconnects SSE by id |
| Duplicate/parallel mixdown requests | Stateless per request; each writes its own file |
| Model download on first use | First job for a new model downloads weights; progress UI shows a "downloading model" stage |

---

## 9. Testing Strategy (TDD)

**Backend — unit**
- `jobs.py`: atomic claim (no double-claim), all state transitions, crash recovery,
  delete cascades files.
- `progress.py`: callback dict → fraction/label across single models, bags (e.g.
  `htdemucs_ft` = 4 models), and with shifts. Pure, fast.
- `schemas.py` validation; `paths.py` determinism; `config.py` defaults/overrides.
- `encode.py`: round-trip a known buffer to wav/flac/mp3 and assert it reads back.

**Backend — integration**
- Worker runs a real separation on a **short clip** (trim the repo's `test.mp3` to a few
  seconds) with the fastest model on CPU; assert all stems exist and are valid audio.
  Marked slow/optional (downloads weights on first run); kept short to stay usable.
- API via `TestClient`: upload validation (good/bad/oversize), enqueue, list/filter,
  SSE event shape (drive by writing progress rows directly), download with range,
  mixdown (mock the renderer), delete.

**Frontend**
- Vitest + React Testing Library: ChannelStrip (mute/solo/volume state), Transport,
  Upload form validation, Dashboard SSE rendering.
- `useStudioEngine` against a mocked `AudioContext`: solo/mute gain routing, transport
  state, A/B toggle.
- One Playwright E2E happy path against a mocked backend: upload → job done → studio
  loads → mute vocals → export.

---

## 10. Project Structure

```
demucs/                         # existing package — untouched
webapp/
  backend/
    app/
      main.py                   # FastAPI app + router wiring
      config.py
      core/  db.py  jobs.py  schemas.py  paths.py  audio_probe.py
      api/   routes_jobs.py  routes_stems.py  routes_mixdown.py  routes_meta.py  sse.py
      worker/  __main__.py  engine.py  progress.py  encode.py
    tests/
    pyproject.toml
  frontend/
    src/
      api/        client.ts  sse.ts
      screens/    Upload.tsx  Dashboard.tsx  Studio.tsx  Library.tsx
      studio/     useStudioEngine.ts  ChannelStrip.tsx  Transport.tsx
                  Waveform.tsx  ABToggle.tsx  ExportPanel.tsx
      store.ts  App.tsx  main.tsx
    package.json  vite.config.ts  tsconfig.json
  data/                         # gitignored: app.db, uploads/, stems/, mixdowns/
  scripts/  run-dev.ps1  run-dev.sh   # launch api + worker + vite together
  README.md
```

Vite dev server proxies `/api` to FastAPI. In "production" (local single-user), FastAPI
serves the built static frontend so the whole thing runs from one command.

---

## 11. Build Order (Milestones)

- **M0 — Scaffold:** backend + frontend skeletons, config, `/health` (ffmpeg + device
  check), one-command dev launch, SQLite schema/migration.
- **M1 — Walking skeleton:** upload → validate → enqueue → worker separates with the
  default model on the detected device → stems on disk → SSE progress → download.
  Minimal UI (upload + progress + download links). End-to-end vertical slice.
- **M2 — Options & robustness:** model picker (+ stem lists), output format/quality,
  stem subset, full input validation, CUDA-OOM fallback, crash recovery.
- **M3 — Studio core:** Web Audio multitrack engine, channel strips (mute/solo/volume),
  transport, synced waveforms.
- **M4 — Mixdown & A/B:** server-side mixdown export with presets (instrumental/
  acapella/custom) + A/B comparison against the original.
- **M5 — Library & batch:** job-history library (reopen/re-download/delete/search) and
  multi-file batch upload/processing.
- **M6 — Polish & package:** one-command launch serving the built SPA, README/setup
  docs (incl. ffmpeg + CUDA notes), test hardening.

Each milestone is independently demoable; M1 already separates a real song.

---

## 12. Key Dependencies

- **Backend:** `fastapi`, `uvicorn`, `pydantic`/`pydantic-settings`, `python-multipart`,
  `soundfile`, and the existing `demucs` + `torch`/`torchaudio` stack. **ffmpeg** on PATH.
- **Frontend:** `react`, `typescript`, `vite`, `wavesurfer.js`, `zustand`.
- No Redis, no Celery, no database server — SQLite + filesystem only.
```
