# Demucs Stem Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local, single-user web app that wraps the Demucs v4 engine into a full "stem studio" — separate FLAC/MP3/WAV into stems, isolate/remove vocals and instruments, mix and compare them in-browser, and export custom mixdowns.

**Architecture:** A FastAPI web process (never imports Torch) accepts uploads and enqueues jobs into a SQLite/WAL database that doubles as the queue. A separate long-lived worker process owns all Torch/Demucs, keeps models warm, claims jobs atomically, runs separation with a progress callback, and writes stems to the local filesystem. The browser (React + TypeScript SPA) drives everything over REST and reads live progress over Server-Sent Events; the studio mixer is a Web Audio engine, and mixdown export is rendered server-side.

**Tech Stack:** Python 3.8+, FastAPI, Uvicorn, pydantic / pydantic-settings, python-multipart, soundfile, the existing `demucs` + `torch`/`torchaudio` stack, SQLite (stdlib), ffmpeg (external). Frontend: React, TypeScript, Vite, wavesurfer.js v7, Zustand. Tests: pytest + FastAPI TestClient (backend), Vitest + React Testing Library + Playwright (frontend).

## Global Constraints

- **Python:** 3.8+ (matches Demucs floor). **Node:** 18+ for the frontend toolchain.
- **The FastAPI web process MUST NOT import `torch`, `demucs.api`, or any model code.** Only the worker process imports Torch. This keeps API startup instant and isolation clean.
- **SQLite is the only datastore and the only cross-process channel.** No Redis, no Celery, no DB server. Open every connection in WAL mode (`PRAGMA journal_mode=WAL`).
- **All stems for a job are always produced.** "Isolation" = solo (UI), "removal" = mute (UI). `requested_stems` only controls which stem *files* are encoded/kept, never re-runs separation.
- **ffmpeg must be on PATH.** It is required for decoding on Windows. `/api/health` must report its presence.
- **Model samplerate is 44.1 kHz** for all supported models; all encoders write at the model samplerate returned by the separator.
- **Storage layout (all under `webapp/data/`, gitignored):** `app.db`, `uploads/{job_id}/source.<ext>`, `stems/{job_id}/{stem}.<ext>`, `mixdowns/{job_id}/{mixdown_id}.<ext>`.
- **Job status values:** `queued | running | done | failed | canceled`. No others.
- **All timestamps are ISO-8601 UTC strings.** Job ids and mixdown ids are `uuid4` hex strings.
- **TDD is mandatory:** every task writes a failing test first, watches it fail, implements the minimum, watches it pass, commits. Commit messages use Conventional Commits (`feat:`, `test:`, `chore:`, `fix:`).
- **Default model:** `htdemucs` (4 stems). Other models are user-selectable but not default.
- **Run all backend commands from `webapp/backend/`** with the project venv active. Run all frontend commands from `webapp/frontend/`.

---

## File Structure

```
webapp/
  backend/
    pyproject.toml                 # backend deps + pytest config
    app/
      __init__.py
      config.py                    # Settings (pydantic-settings) + get_settings()
      main.py                      # FastAPI app factory, router wiring, static serving
      core/
        __init__.py
        db.py                      # connection factory (WAL), init_db()
        schemas.py                 # Pydantic models (the API/worker contract)
        paths.py                   # storage path helpers
        jobs.py                    # job store: create/list/get/claim/update/finish/fail/delete
        audio_probe.py             # validate + probe uploaded audio
      api/
        __init__.py
        routes_meta.py             # GET /health, GET /models
        routes_jobs.py             # POST/GET/DELETE /jobs
        routes_stems.py            # GET /jobs/{id}/stems/{stem}
        routes_mixdown.py          # POST /jobs/{id}/mixdown, GET /mixdowns/{id}/download
        sse.py                     # GET /jobs/{id}/events
      worker/
        __init__.py
        __main__.py                # claim->run->finish loop + crash recovery
        progress.py                # pure callback-dict -> (fraction, stage)
        engine.py                  # device detect, model LRU cache, run_separation
        encode.py                  # save_stem + render_mixdown (wav/flac/mp3)
    tests/
      conftest.py
      test_paths.py  test_schemas.py  test_jobs.py  test_audio_probe.py
      test_progress.py  test_encode.py
      test_api_meta.py  test_api_jobs.py  test_api_sse.py
      test_api_stems.py  test_api_mixdown.py
      test_worker_loop.py  test_engine_integration.py
      fixtures/clip.wav            # ~3s test clip generated in M1
  frontend/
    package.json  vite.config.ts  tsconfig.json  vitest.config.ts
    index.html
    src/
      main.tsx  App.tsx  store.ts  types.ts
      api/ client.ts  sse.ts
      screens/ Upload.tsx  Dashboard.tsx  Studio.tsx  Library.tsx
      studio/ useStudioEngine.ts  ChannelStrip.tsx  Transport.tsx
              Waveform.tsx  ABToggle.tsx  ExportPanel.tsx
    tests/ (component + engine + e2e specs colocated or under src/__tests__)
  data/                            # gitignored runtime storage
  scripts/ run-dev.ps1  run-dev.sh
  README.md
```

---

## Phase M0 — Scaffold

Goal: a backend that boots, a database that initializes, and a `/health` + `/models` endpoint — all under test. No Torch yet.

### Task 1: Backend package + settings

**Files:**
- Create: `webapp/backend/pyproject.toml`, `webapp/backend/app/__init__.py`, `webapp/backend/app/config.py`, `webapp/backend/tests/conftest.py`, `webapp/backend/tests/test_config.py`

**Interfaces:**
- Produces: `app.config.Settings` (pydantic-settings) and `app.config.get_settings() -> Settings` (lru_cached). Fields: `data_dir: Path`, `max_upload_bytes: int`, `default_model: str`, `default_output_format: str`, `port: int`, `max_attempts: int`, `model_cache_size: int`, `sse_poll_interval: float`, `worker_poll_interval: float`. Env prefix `STUDIO_`.

- [ ] **Step 1: Write the failing test** — `webapp/backend/tests/test_config.py`

```python
from app.config import get_settings


def test_defaults(monkeypatch):
    monkeypatch.delenv("STUDIO_DEFAULT_MODEL", raising=False)
    get_settings.cache_clear()
    s = get_settings()
    assert s.default_model == "htdemucs"
    assert s.max_upload_bytes == 200 * 1024 * 1024
    assert str(s.data_dir).endswith("data")


def test_env_override(monkeypatch):
    monkeypatch.setenv("STUDIO_DEFAULT_MODEL", "mdx_extra")
    get_settings.cache_clear()
    assert get_settings().default_model == "mdx_extra"
    get_settings.cache_clear()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd webapp/backend && python -m pytest tests/test_config.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app'` / `app.config`.

- [ ] **Step 3: Create `webapp/backend/pyproject.toml`**

```toml
[project]
name = "demucs-stem-studio-backend"
version = "0.1.0"
requires-python = ">=3.8"
dependencies = [
  "fastapi>=0.110",
  "uvicorn[standard]>=0.29",
  "pydantic>=2.6",
  "pydantic-settings>=2.2",
  "python-multipart>=0.0.9",
  "soundfile>=0.12",
]

[project.optional-dependencies]
dev = ["pytest>=8", "httpx>=0.27"]

[tool.pytest.ini_options]
pythonpath = ["."]
addopts = "-q"
markers = ["integration: requires torch/demucs and model download (slow)"]
```

- [ ] **Step 4: Create `webapp/backend/app/__init__.py`** (empty file)

- [ ] **Step 5: Create `webapp/backend/app/config.py`**

```python
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="STUDIO_", env_file=".env", protected_namespaces=()
    )

    data_dir: Path = Path("data")
    max_upload_bytes: int = 200 * 1024 * 1024
    default_model: str = "htdemucs"
    default_output_format: str = "wav"
    port: int = 8000
    max_attempts: int = 1
    model_cache_size: int = 2
    sse_poll_interval: float = 0.4
    worker_poll_interval: float = 0.5


@lru_cache
def get_settings() -> Settings:
    return Settings()
```

- [ ] **Step 6: Create `webapp/backend/tests/conftest.py`**

```python
import pytest

from app.config import get_settings


@pytest.fixture
def settings(tmp_path, monkeypatch):
    monkeypatch.setenv("STUDIO_DATA_DIR", str(tmp_path / "data"))
    get_settings.cache_clear()
    yield get_settings()
    get_settings.cache_clear()


@pytest.fixture
def conn(settings):
    from app.core.db import get_connection, init_db

    c = get_connection()
    init_db(c)
    yield c
    c.close()
```

- [ ] **Step 7: Run test to verify it passes**

Run: `cd webapp/backend && python -m pytest tests/test_config.py -v`
Expected: PASS (2 passed).

- [ ] **Step 8: Commit**

```bash
git add webapp/backend/pyproject.toml webapp/backend/app/__init__.py webapp/backend/app/config.py webapp/backend/tests/conftest.py webapp/backend/tests/test_config.py
git commit -m "feat(backend): scaffold package and settings"
```

---

### Task 2: Storage path helpers

**Files:**
- Create: `webapp/backend/app/core/__init__.py`, `webapp/backend/app/core/paths.py`, `webapp/backend/tests/test_paths.py`

**Interfaces:**
- Produces: `app.core.paths` with `upload_path(job_id, ext) -> Path`, `stems_dir(job_id) -> Path`, `stem_path(job_id, stem, ext) -> Path`, `mixdowns_dir(job_id) -> Path`, `mixdown_path(job_id, mixdown_id, ext) -> Path`, `job_upload_dir(job_id) -> Path`, `ensure_parent(p) -> Path`. All rooted at `get_settings().data_dir`.

- [ ] **Step 1: Write the failing test** — `webapp/backend/tests/test_paths.py`

```python
from app.core import paths


def test_paths_rooted_in_data_dir(settings):
    root = settings.data_dir
    assert paths.upload_path("job1", "mp3") == root / "uploads" / "job1" / "source.mp3"
    assert paths.upload_path("job1", ".flac") == root / "uploads" / "job1" / "source.flac"
    assert paths.stem_path("job1", "vocals", "wav") == root / "stems" / "job1" / "vocals.wav"
    assert paths.mixdown_path("job1", "mx1", "mp3") == root / "mixdowns" / "job1" / "mx1.mp3"


def test_ensure_parent_creates_dir(settings, tmp_path):
    target = paths.stem_path("jobX", "bass", "wav")
    paths.ensure_parent(target)
    assert target.parent.is_dir()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd webapp/backend && python -m pytest tests/test_paths.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.core'`.

- [ ] **Step 3: Create `webapp/backend/app/core/__init__.py`** (empty file)

- [ ] **Step 4: Create `webapp/backend/app/core/paths.py`**

```python
from __future__ import annotations

from pathlib import Path

from app.config import get_settings


def _root() -> Path:
    return get_settings().data_dir


def job_upload_dir(job_id: str) -> Path:
    return _root() / "uploads" / job_id


def upload_path(job_id: str, ext: str) -> Path:
    return job_upload_dir(job_id) / f"source.{ext.lstrip('.')}"


def stems_dir(job_id: str) -> Path:
    return _root() / "stems" / job_id


def stem_path(job_id: str, stem: str, ext: str) -> Path:
    return stems_dir(job_id) / f"{stem}.{ext.lstrip('.')}"


def mixdowns_dir(job_id: str) -> Path:
    return _root() / "mixdowns" / job_id


def mixdown_path(job_id: str, mixdown_id: str, ext: str) -> Path:
    return mixdowns_dir(job_id) / f"{mixdown_id}.{ext.lstrip('.')}"


def ensure_parent(p: Path) -> Path:
    p.parent.mkdir(parents=True, exist_ok=True)
    return p
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd webapp/backend && python -m pytest tests/test_paths.py -v`
Expected: PASS (2 passed).

- [ ] **Step 6: Commit**

```bash
git add webapp/backend/app/core/__init__.py webapp/backend/app/core/paths.py webapp/backend/tests/test_paths.py
git commit -m "feat(backend): storage path helpers"
```

---

### Task 3: SQLite connection + schema

**Files:**
- Create: `webapp/backend/app/core/db.py`, `webapp/backend/tests/test_db.py`

**Interfaces:**
- Produces: `app.core.db` with `db_path() -> Path`, `get_connection() -> sqlite3.Connection` (WAL, `Row` factory, FK on), `init_db(conn=None) -> None` (idempotent). Tables: `jobs`, `mixdowns`, `meta` (key/value).

- [ ] **Step 1: Write the failing test** — `webapp/backend/tests/test_db.py`

```python
from app.core.db import get_connection, init_db


def test_init_db_idempotent(settings):
    c = get_connection()
    init_db(c)
    init_db(c)  # second call must not raise
    tables = {r["name"] for r in c.execute(
        "SELECT name FROM sqlite_master WHERE type='table'"
    )}
    assert {"jobs", "mixdowns", "meta"} <= tables
    assert c.execute("PRAGMA journal_mode").fetchone()[0].lower() == "wal"
    c.close()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd webapp/backend && python -m pytest tests/test_db.py -v`
Expected: FAIL — cannot import `app.core.db`.

- [ ] **Step 3: Create `webapp/backend/app/core/db.py`**

```python
from __future__ import annotations

import sqlite3
from pathlib import Path

from app.config import get_settings

SCHEMA = """
CREATE TABLE IF NOT EXISTS jobs (
  id              TEXT PRIMARY KEY,
  batch_id        TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  status          TEXT NOT NULL,
  attempts        INTEGER NOT NULL DEFAULT 0,
  source_filename TEXT NOT NULL,
  source_path     TEXT NOT NULL,
  source_format   TEXT,
  source_duration REAL,
  source_bytes    INTEGER,
  model           TEXT NOT NULL,
  output_format   TEXT NOT NULL,
  output_bitrate  INTEGER,
  output_bitdepth INTEGER,
  requested_stems TEXT,
  device_used     TEXT,
  progress        REAL NOT NULL DEFAULT 0,
  progress_stage  TEXT,
  stems           TEXT,
  error_message   TEXT
);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status, created_at);
CREATE INDEX IF NOT EXISTS idx_jobs_batch  ON jobs(batch_id);

CREATE TABLE IF NOT EXISTS mixdowns (
  id         TEXT PRIMARY KEY,
  job_id     TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  spec       TEXT NOT NULL,
  path       TEXT NOT NULL,
  format     TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);
"""


def db_path() -> Path:
    return get_settings().data_dir / "app.db"


def get_connection() -> sqlite3.Connection:
    p = db_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(p, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db(conn: sqlite3.Connection | None = None) -> None:
    own = conn is None
    conn = conn or get_connection()
    conn.executescript(SCHEMA)
    conn.commit()
    if own:
        conn.close()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd webapp/backend && python -m pytest tests/test_db.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add webapp/backend/app/core/db.py webapp/backend/tests/test_db.py
git commit -m "feat(backend): sqlite connection and schema"
```

---

### Task 4: Pydantic schemas (the contract)

**Files:**
- Create: `webapp/backend/app/core/schemas.py`, `webapp/backend/tests/test_schemas.py`

**Interfaces:**
- Produces: `app.core.schemas` with `JobStatus`, `OutputFormat` (Literals); models `JobCreate`, `JobOut`, `MixdownTrack`, `MixdownRequest`, `MixdownOut`, `ModelInfo`, `HealthOut`. Field names exactly match the `jobs` columns (plus parsed `requested_stems: list[str] | None`, `stems: dict[str,str] | None`).

- [ ] **Step 1: Write the failing test** — `webapp/backend/tests/test_schemas.py`

```python
from app.core.schemas import JobCreate, JobOut, MixdownRequest


def test_jobcreate_defaults():
    j = JobCreate()
    assert j.model == "htdemucs"
    assert j.output_format == "wav"
    assert j.requested_stems is None


def test_jobout_from_row_dict():
    row = dict(
        id="a", batch_id=None, created_at="t", updated_at="t", status="queued",
        attempts=0, source_filename="x.mp3", source_format="mp3",
        source_duration=10.0, source_bytes=123, model="htdemucs",
        output_format="wav", output_bitrate=None, output_bitdepth=16,
        requested_stems=["vocals"], device_used=None, progress=0.0,
        progress_stage=None, stems={"vocals": "p"}, error_message=None,
    )
    out = JobOut(**row)
    assert out.status == "queued"
    assert out.stems == {"vocals": "p"}


def test_mixdown_request_validation():
    m = MixdownRequest(tracks=[{"stem": "vocals", "gain": 0.0, "muted": True}])
    assert m.tracks[0].muted is True
    assert m.format == "mp3"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd webapp/backend && python -m pytest tests/test_schemas.py -v`
Expected: FAIL — cannot import `app.core.schemas`.

- [ ] **Step 3: Create `webapp/backend/app/core/schemas.py`**

```python
from __future__ import annotations

from typing import Dict, List, Literal, Optional

from pydantic import BaseModel

JobStatus = Literal["queued", "running", "done", "failed", "canceled"]
OutputFormat = Literal["wav", "flac", "mp3"]


class JobCreate(BaseModel):
    model: str = "htdemucs"
    output_format: OutputFormat = "wav"
    output_bitrate: Optional[int] = 320
    output_bitdepth: Optional[int] = 16
    requested_stems: Optional[List[str]] = None
    batch_id: Optional[str] = None


class JobOut(BaseModel):
    id: str
    batch_id: Optional[str] = None
    created_at: str
    updated_at: str
    status: JobStatus
    attempts: int
    source_filename: str
    source_path: Optional[str] = None
    source_format: Optional[str] = None
    source_duration: Optional[float] = None
    source_bytes: Optional[int] = None
    model: str
    output_format: OutputFormat
    output_bitrate: Optional[int] = None
    output_bitdepth: Optional[int] = None
    requested_stems: Optional[List[str]] = None
    device_used: Optional[str] = None
    progress: float
    progress_stage: Optional[str] = None
    stems: Optional[Dict[str, str]] = None
    error_message: Optional[str] = None


class MixdownTrack(BaseModel):
    stem: str
    gain: float = 1.0
    muted: bool = False


class MixdownRequest(BaseModel):
    name: str = "mixdown"
    format: OutputFormat = "mp3"
    bitrate: Optional[int] = 320
    bitdepth: Optional[int] = 16
    tracks: List[MixdownTrack]


class MixdownOut(BaseModel):
    id: str
    job_id: str
    name: str
    format: OutputFormat
    created_at: str


class ModelInfo(BaseModel):
    name: str
    stems: List[str]
    description: str = ""


class HealthOut(BaseModel):
    db: bool
    ffmpeg: bool
    worker_alive: bool
    device: Optional[str] = None
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd webapp/backend && python -m pytest tests/test_schemas.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add webapp/backend/app/core/schemas.py webapp/backend/tests/test_schemas.py
git commit -m "feat(backend): pydantic contract schemas"
```

---

### Task 5: Job store

**Files:**
- Create: `webapp/backend/app/core/jobs.py`, `webapp/backend/tests/test_jobs.py`

**Interfaces:**
- Consumes: `JobCreate`/`JobOut` (Task 4), `paths` (Task 2), a sqlite connection (Task 3).
- Produces: `app.core.jobs` with `create_job(conn, *, source_filename, source_path, source_format, source_duration, source_bytes, spec) -> JobOut`, `get_job(conn, jid) -> JobOut | None`, `list_jobs(conn, *, status=None, batch_id=None, limit=100, offset=0) -> list[JobOut]`, `claim_next(conn, device) -> JobOut | None` (atomic; increments `attempts`), `update_progress(conn, jid, progress, stage=None)`, `finish_job(conn, jid, stems: dict)`, `fail_or_requeue(conn, jid, message, max_attempts)`, `cancel_job(conn, jid) -> bool`, `recover_stuck(conn, max_attempts)`, `delete_job(conn, jid) -> bool`, `set_meta(conn, key, value)`, `get_meta(conn, key) -> str | None`.

- [ ] **Step 1: Write the failing test** — `webapp/backend/tests/test_jobs.py`

```python
from app.core import jobs
from app.core.schemas import JobCreate


def _make(conn, name="song.mp3"):
    return jobs.create_job(
        conn, source_filename=name, source_path=f"/tmp/{name}",
        source_format="mp3", source_duration=12.3, source_bytes=999,
        spec=JobCreate(),
    )


def test_create_and_get(conn):
    j = _make(conn)
    assert j.status == "queued"
    assert jobs.get_job(conn, j.id).source_filename == "song.mp3"


def test_claim_is_atomic(conn):
    a = _make(conn, "a.mp3")
    b = _make(conn, "b.mp3")
    first = jobs.claim_next(conn, "cpu")
    second = jobs.claim_next(conn, "cpu")
    third = jobs.claim_next(conn, "cpu")
    assert {first.id, second.id} == {a.id, b.id}
    assert first.status == "running" and first.attempts == 1
    assert third is None


def test_progress_and_finish(conn):
    j = jobs.claim_next(conn, "cpu") or _make(conn)
    j = jobs.claim_next(conn, "cpu") if j is None else j
    jobs.update_progress(conn, j.id, 0.5, "model 1/1")
    assert jobs.get_job(conn, j.id).progress == 0.5
    jobs.finish_job(conn, j.id, {"vocals": "stems/x/vocals.wav"})
    done = jobs.get_job(conn, j.id)
    assert done.status == "done" and done.stems["vocals"].endswith("vocals.wav")


def test_fail_or_requeue_then_fail(conn):
    _make(conn)
    j = jobs.claim_next(conn, "cpu")            # attempts=1
    jobs.fail_or_requeue(conn, j.id, "boom", max_attempts=1)
    assert jobs.get_job(conn, j.id).status == "queued"
    j = jobs.claim_next(conn, "cpu")            # attempts=2
    jobs.fail_or_requeue(conn, j.id, "boom", max_attempts=1)
    failed = jobs.get_job(conn, j.id)
    assert failed.status == "failed" and failed.error_message == "boom"


def test_recover_stuck_requeues(conn):
    _make(conn)
    j = jobs.claim_next(conn, "cpu")
    jobs.recover_stuck(conn, max_attempts=1)
    assert jobs.get_job(conn, j.id).status == "queued"


def test_delete_removes_files(conn, settings):
    from app.core import paths
    j = _make(conn)
    p = paths.stem_path(j.id, "vocals", "wav")
    paths.ensure_parent(p)
    p.write_bytes(b"x")
    assert jobs.delete_job(conn, j.id) is True
    assert jobs.get_job(conn, j.id) is None
    assert not p.exists()


def test_meta_roundtrip(conn):
    jobs.set_meta(conn, "device", "cuda")
    jobs.set_meta(conn, "device", "cpu")
    assert jobs.get_meta(conn, "device") == "cpu"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd webapp/backend && python -m pytest tests/test_jobs.py -v`
Expected: FAIL — cannot import `app.core.jobs`.

- [ ] **Step 3: Create `webapp/backend/app/core/jobs.py`**

```python
from __future__ import annotations

import json
import shutil
import uuid
from datetime import datetime, timezone
from typing import Optional

from app.core import paths
from app.core.schemas import JobCreate, JobOut


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _row_to_job(row) -> JobOut:
    d = dict(row)
    d["requested_stems"] = json.loads(d["requested_stems"]) if d.get("requested_stems") else None
    d["stems"] = json.loads(d["stems"]) if d.get("stems") else None
    return JobOut(**d)


def create_job(conn, *, source_filename, source_path, source_format,
               source_duration, source_bytes, spec: JobCreate,
               job_id: Optional[str] = None) -> JobOut:
    jid = job_id or uuid.uuid4().hex
    now = _now()
    conn.execute(
        """INSERT INTO jobs (id,batch_id,created_at,updated_at,status,attempts,
            source_filename,source_path,source_format,source_duration,source_bytes,
            model,output_format,output_bitrate,output_bitdepth,requested_stems,progress)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (jid, spec.batch_id, now, now, "queued", 0,
         source_filename, str(source_path), source_format, source_duration, source_bytes,
         spec.model, spec.output_format, spec.output_bitrate, spec.output_bitdepth,
         json.dumps(spec.requested_stems) if spec.requested_stems else None, 0.0),
    )
    conn.commit()
    return get_job(conn, jid)


def get_job(conn, jid) -> Optional[JobOut]:
    row = conn.execute("SELECT * FROM jobs WHERE id=?", (jid,)).fetchone()
    return _row_to_job(row) if row else None


def list_jobs(conn, *, status=None, batch_id=None, limit=100, offset=0):
    q = "SELECT * FROM jobs"
    clauses, args = [], []
    if status:
        clauses.append("status=?"); args.append(status)
    if batch_id:
        clauses.append("batch_id=?"); args.append(batch_id)
    if clauses:
        q += " WHERE " + " AND ".join(clauses)
    q += " ORDER BY created_at DESC LIMIT ? OFFSET ?"
    args += [limit, offset]
    return [_row_to_job(r) for r in conn.execute(q, args).fetchall()]


def claim_next(conn, device) -> Optional[JobOut]:
    conn.execute("BEGIN IMMEDIATE")
    row = conn.execute(
        "SELECT id FROM jobs WHERE status='queued' ORDER BY created_at LIMIT 1"
    ).fetchone()
    if not row:
        conn.commit()
        return None
    jid = row["id"]
    conn.execute(
        "UPDATE jobs SET status='running', device_used=?, attempts=attempts+1, updated_at=? WHERE id=?",
        (device, _now(), jid),
    )
    conn.commit()
    return get_job(conn, jid)


def update_progress(conn, jid, progress, stage=None) -> None:
    conn.execute(
        "UPDATE jobs SET progress=?, progress_stage=?, updated_at=? WHERE id=?",
        (progress, stage, _now(), jid),
    )
    conn.commit()


def finish_job(conn, jid, stems: dict) -> None:
    conn.execute(
        "UPDATE jobs SET status='done', progress=1.0, stems=?, error_message=NULL, updated_at=? WHERE id=?",
        (json.dumps(stems), _now(), jid),
    )
    conn.commit()


def fail_or_requeue(conn, jid, message, max_attempts) -> None:
    job = get_job(conn, jid)
    requeue = job is not None and job.attempts <= max_attempts
    status = "queued" if requeue else "failed"
    conn.execute(
        "UPDATE jobs SET status=?, error_message=?, updated_at=? WHERE id=?",
        (status, message, _now(), jid),
    )
    conn.commit()


def cancel_job(conn, jid) -> bool:
    cur = conn.execute(
        "UPDATE jobs SET status='canceled', updated_at=? WHERE id=? AND status='queued'",
        (_now(), jid),
    )
    conn.commit()
    return cur.rowcount > 0


def recover_stuck(conn, max_attempts) -> None:
    rows = conn.execute("SELECT id, attempts FROM jobs WHERE status='running'").fetchall()
    for r in rows:
        if r["attempts"] <= max_attempts:
            conn.execute("UPDATE jobs SET status='queued', updated_at=? WHERE id=?", (_now(), r["id"]))
        else:
            conn.execute(
                "UPDATE jobs SET status='failed', error_message=?, updated_at=? WHERE id=?",
                ("Worker interrupted mid-job", _now(), r["id"]),
            )
    conn.commit()


def delete_job(conn, jid) -> bool:
    if get_job(conn, jid) is None:
        return False
    conn.execute("DELETE FROM jobs WHERE id=?", (jid,))
    conn.commit()
    for d in (paths.stems_dir(jid), paths.mixdowns_dir(jid), paths.job_upload_dir(jid)):
        shutil.rmtree(d, ignore_errors=True)
    return True


def set_meta(conn, key, value) -> None:
    conn.execute(
        "INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        (key, value),
    )
    conn.commit()


def get_meta(conn, key) -> Optional[str]:
    r = conn.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
    return r["value"] if r else None
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd webapp/backend && python -m pytest tests/test_jobs.py -v`
Expected: PASS (7 passed).

- [ ] **Step 5: Commit**

```bash
git add webapp/backend/app/core/jobs.py webapp/backend/tests/test_jobs.py
git commit -m "feat(backend): job store with atomic claim and recovery"
```

---

### Task 6: App factory + `/health` + `/models`

**Files:**
- Create: `webapp/backend/app/main.py`, `webapp/backend/app/api/__init__.py`, `webapp/backend/app/api/routes_meta.py`, `webapp/backend/tests/test_api_meta.py`

**Interfaces:**
- Consumes: `db.init_db`, `jobs.get_meta`, `schemas.HealthOut`/`ModelInfo`.
- Produces: `app.main.create_app() -> FastAPI`; `app.api.routes_meta.MODELS: list[ModelInfo]` constant; routes `GET /api/health`, `GET /api/models`. Worker liveness derived from `meta` key `worker_heartbeat` (ISO time within 15s) and `meta` key `device`.

- [ ] **Step 1: Write the failing test** — `webapp/backend/tests/test_api_meta.py`

```python
from fastapi.testclient import TestClient

from app.main import create_app


def test_health_ok(settings):
    client = TestClient(create_app())
    r = client.get("/api/health")
    assert r.status_code == 200
    body = r.json()
    assert body["db"] is True
    assert "ffmpeg" in body and "worker_alive" in body


def test_models_lists_htdemucs(settings):
    client = TestClient(create_app())
    r = client.get("/api/models")
    names = {m["name"]: m for m in r.json()}
    assert "htdemucs" in names
    assert names["htdemucs"]["stems"] == ["drums", "bass", "other", "vocals"]
    assert set(names["htdemucs_6s"]["stems"]) >= {"guitar", "piano"}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd webapp/backend && python -m pytest tests/test_api_meta.py -v`
Expected: FAIL — cannot import `app.main`.

- [ ] **Step 3: Create `webapp/backend/app/api/__init__.py`** (empty file)

- [ ] **Step 4: Create `webapp/backend/app/api/routes_meta.py`**

```python
from __future__ import annotations

import shutil
from datetime import datetime, timezone
from typing import List

from fastapi import APIRouter

from app.config import get_settings
from app.core import jobs
from app.core.db import get_connection
from app.core.schemas import HealthOut, ModelInfo

router = APIRouter(prefix="/api")

MODELS = [
    ModelInfo(name="htdemucs", stems=["drums", "bass", "other", "vocals"],
              description="Default Hybrid Transformer Demucs (fast, 4 stems)."),
    ModelInfo(name="htdemucs_ft", stems=["drums", "bass", "other", "vocals"],
              description="Fine-tuned htdemucs (~4x slower, slightly better)."),
    ModelInfo(name="htdemucs_6s", stems=["drums", "bass", "other", "vocals", "guitar", "piano"],
              description="6 stems incl. guitar/piano (piano stem is weak)."),
    ModelInfo(name="hdemucs_mmi", stems=["drums", "bass", "other", "vocals"],
              description="Hybrid Demucs v3 retrained."),
    ModelInfo(name="mdx_extra", stems=["drums", "bass", "other", "vocals"],
              description="MDX extra-trained alternative."),
]


def _worker_alive(conn) -> bool:
    hb = jobs.get_meta(conn, "worker_heartbeat")
    if not hb:
        return False
    try:
        last = datetime.fromisoformat(hb)
    except ValueError:
        return False
    return (datetime.now(timezone.utc) - last).total_seconds() < 15


@router.get("/health", response_model=HealthOut)
def health() -> HealthOut:
    conn = get_connection()
    try:
        db_ok = conn.execute("SELECT 1").fetchone() is not None
        return HealthOut(
            db=db_ok,
            ffmpeg=shutil.which("ffmpeg") is not None,
            worker_alive=_worker_alive(conn),
            device=jobs.get_meta(conn, "device"),
        )
    finally:
        conn.close()


@router.get("/models", response_model=List[ModelInfo])
def models() -> List[ModelInfo]:
    return MODELS
```

- [ ] **Step 5: Create `webapp/backend/app/main.py`**

```python
from __future__ import annotations

from fastapi import FastAPI

from app.core.db import init_db


def create_app() -> FastAPI:
    app = FastAPI(title="Demucs Stem Studio")
    init_db()  # idempotent; ensures tables exist for TestClient and dev runs alike

    from app.api import routes_meta
    app.include_router(routes_meta.router)
    return app


app = create_app()
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd webapp/backend && python -m pytest tests/test_api_meta.py -v`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add webapp/backend/app/main.py webapp/backend/app/api/__init__.py webapp/backend/app/api/routes_meta.py webapp/backend/tests/test_api_meta.py
git commit -m "feat(backend): app factory with health and models endpoints"
```

**M0 demo:** `cd webapp/backend && uvicorn app.main:app` then open `/docs`, `/api/health`, `/api/models`.

---

## Phase M1 — Walking skeleton (end-to-end vertical slice)

Goal: upload a real song → worker separates it with the default model on the detected device → stems on disk → live SSE progress → download. Minimal UI proves the whole pipeline.

### Task 7: Audio validation + probe

**Files:**
- Create: `webapp/backend/app/core/audio_probe.py`, `webapp/backend/tests/test_audio_probe.py`

**Interfaces:**
- Produces: `app.core.audio_probe` with `ALLOWED_EXT: set[str]`, `class UploadError(Exception)` (attrs `status_code`, `detail`), `ext_of(filename) -> str`, `validate_upload(filename, size_bytes) -> str` (returns ext or raises `UploadError`), `probe(path) -> tuple[float | None, str | None]` (duration_seconds, format_name) via `ffprobe`. Must NOT import torch/torchaudio.

- [ ] **Step 1: Write the failing test** — `webapp/backend/tests/test_audio_probe.py`

```python
import pytest

from app.core import audio_probe as ap


def test_validate_rejects_unknown_ext(settings):
    with pytest.raises(ap.UploadError) as e:
        ap.validate_upload("notes.txt", 10)
    assert e.value.status_code == 415


def test_validate_rejects_oversize(settings, monkeypatch):
    monkeypatch.setattr(ap.get_settings(), "max_upload_bytes", 5, raising=False)
    with pytest.raises(ap.UploadError) as e:
        ap.validate_upload("song.mp3", 6)
    assert e.value.status_code == 413


def test_validate_accepts_audio(settings):
    assert ap.validate_upload("Song Name.FLAC", 100) == "flac"


def test_probe_parses_ffprobe(monkeypatch, tmp_path):
    import subprocess

    class FakeProc:
        stdout = '{"format": {"duration": "12.50", "format_name": "mp3"}}'

    monkeypatch.setattr(subprocess, "run", lambda *a, **k: FakeProc())
    dur, fmt = ap.probe(tmp_path / "x.mp3")
    assert dur == 12.5 and fmt == "mp3"


def test_probe_handles_missing_ffprobe(monkeypatch, tmp_path):
    import subprocess

    def boom(*a, **k):
        raise FileNotFoundError()

    monkeypatch.setattr(subprocess, "run", boom)
    assert ap.probe(tmp_path / "x.mp3") == (None, None)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd webapp/backend && python -m pytest tests/test_audio_probe.py -v`
Expected: FAIL — cannot import `app.core.audio_probe`.

- [ ] **Step 3: Create `webapp/backend/app/core/audio_probe.py`**

```python
from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Optional, Tuple

from app.config import get_settings

ALLOWED_EXT = {"mp3", "flac", "wav", "ogg", "m4a", "aac", "aiff", "aif", "wma"}


class UploadError(Exception):
    def __init__(self, status_code: int, detail: str):
        self.status_code = status_code
        self.detail = detail
        super().__init__(detail)


def ext_of(filename: str) -> str:
    return Path(filename).suffix.lower().lstrip(".")


def validate_upload(filename: str, size_bytes: int) -> str:
    ext = ext_of(filename)
    if ext not in ALLOWED_EXT:
        raise UploadError(415, f"Unsupported file type: .{ext or '?'}")
    if size_bytes > get_settings().max_upload_bytes:
        raise UploadError(413, "File too large")
    return ext


def probe(path) -> Tuple[Optional[float], Optional[str]]:
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", str(path)],
            capture_output=True, text=True, check=True,
        ).stdout
        fmt = json.loads(out).get("format", {})
        dur = float(fmt["duration"]) if "duration" in fmt else None
        return dur, fmt.get("format_name")
    except (subprocess.CalledProcessError, FileNotFoundError, ValueError, KeyError):
        return None, None
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd webapp/backend && python -m pytest tests/test_audio_probe.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add webapp/backend/app/core/audio_probe.py webapp/backend/tests/test_audio_probe.py
git commit -m "feat(backend): upload validation and ffprobe metadata"
```

---

### Task 8: Jobs REST routes (upload / list / get / delete / cancel)

**Files:**
- Create: `webapp/backend/app/api/routes_jobs.py`, `webapp/backend/tests/test_api_jobs.py`
- Modify: `webapp/backend/app/main.py` (include the router)

**Interfaces:**
- Consumes: `jobs`, `paths`, `audio_probe`, `JobCreate`/`JobOut`.
- Produces: routes `POST /api/jobs` (multipart) → `JobOut`; `GET /api/jobs?status=&batch_id=&limit=&offset=` → `list[JobOut]`; `GET /api/jobs/{id}` → `JobOut`; `DELETE /api/jobs/{id}` → `{"deleted": bool}`; `POST /api/jobs/{id}/cancel` → `JobOut`.

- [ ] **Step 1: Write the failing test** — `webapp/backend/tests/test_api_jobs.py`

```python
import io

from fastapi.testclient import TestClient

from app.main import create_app


def _client(settings):
    return TestClient(create_app())


def _wav_bytes():
    # 0.1s of silence, mono, 8kHz, valid WAV via stdlib (no torch needed)
    import wave

    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(8000)
        w.writeframes(b"\x00\x00" * 800)
    return buf.getvalue()


def test_upload_creates_queued_job(settings, monkeypatch):
    # avoid requiring ffprobe in CI
    monkeypatch.setattr("app.api.routes_jobs.probe", lambda p: (0.1, "wav"))
    client = _client(settings)
    r = client.post(
        "/api/jobs",
        files={"file": ("clip.wav", _wav_bytes(), "audio/wav")},
        data={"model": "htdemucs", "output_format": "wav"},
    )
    assert r.status_code == 200, r.text
    job = r.json()
    assert job["status"] == "queued" and job["model"] == "htdemucs"
    assert client.get(f"/api/jobs/{job['id']}").json()["id"] == job["id"]
    assert any(j["id"] == job["id"] for j in client.get("/api/jobs").json())


def test_upload_rejects_bad_type(settings):
    client = _client(settings)
    r = client.post("/api/jobs", files={"file": ("notes.txt", b"hi", "text/plain")})
    assert r.status_code == 415


def test_delete_job(settings, monkeypatch):
    monkeypatch.setattr("app.api.routes_jobs.probe", lambda p: (0.1, "wav"))
    client = _client(settings)
    jid = client.post("/api/jobs", files={"file": ("c.wav", _wav_bytes(), "audio/wav")}).json()["id"]
    assert client.delete(f"/api/jobs/{jid}").json()["deleted"] is True
    assert client.get(f"/api/jobs/{jid}").status_code == 404
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd webapp/backend && python -m pytest tests/test_api_jobs.py -v`
Expected: FAIL — cannot import `app.api.routes_jobs`.

- [ ] **Step 3: Create `webapp/backend/app/api/routes_jobs.py`**

```python
from __future__ import annotations

import uuid
from typing import List, Optional

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile

from app.core import jobs, paths
from app.core.audio_probe import UploadError, probe, validate_upload
from app.core.db import get_connection
from app.core.schemas import JobCreate, JobOut

router = APIRouter(prefix="/api")


@router.post("/jobs", response_model=JobOut)
async def create_job_route(
    file: UploadFile = File(...),
    model: str = Form("htdemucs"),
    output_format: str = Form("wav"),
    output_bitrate: Optional[int] = Form(320),
    output_bitdepth: Optional[int] = Form(16),
    stems: Optional[str] = Form(None),
    batch_id: Optional[str] = Form(None),
):
    data = await file.read()
    try:
        ext = validate_upload(file.filename or "upload", len(data))
    except UploadError as e:
        raise HTTPException(e.status_code, e.detail)

    jid = uuid.uuid4().hex
    dest = paths.ensure_parent(paths.upload_path(jid, ext))
    dest.write_bytes(data)
    duration, fmt = probe(dest)

    spec = JobCreate(
        model=model,
        output_format=output_format,
        output_bitrate=output_bitrate,
        output_bitdepth=output_bitdepth,
        requested_stems=[s for s in stems.split(",") if s] if stems else None,
        batch_id=batch_id,
    )
    conn = get_connection()
    try:
        return jobs.create_job(
            conn, job_id=jid, source_filename=file.filename or "upload",
            source_path=str(dest), source_format=fmt or ext,
            source_duration=duration, source_bytes=len(data), spec=spec,
        )
    finally:
        conn.close()


@router.get("/jobs", response_model=List[JobOut])
def list_jobs_route(
    status: Optional[str] = Query(None),
    batch_id: Optional[str] = Query(None),
    limit: int = Query(100), offset: int = Query(0),
):
    conn = get_connection()
    try:
        return jobs.list_jobs(conn, status=status, batch_id=batch_id, limit=limit, offset=offset)
    finally:
        conn.close()


@router.get("/jobs/{jid}", response_model=JobOut)
def get_job_route(jid: str):
    conn = get_connection()
    try:
        job = jobs.get_job(conn, jid)
        if not job:
            raise HTTPException(404, "Job not found")
        return job
    finally:
        conn.close()


@router.post("/jobs/{jid}/cancel", response_model=JobOut)
def cancel_job_route(jid: str):
    conn = get_connection()
    try:
        if not jobs.cancel_job(conn, jid):
            raise HTTPException(409, "Job is not cancelable (already running or finished)")
        return jobs.get_job(conn, jid)
    finally:
        conn.close()


@router.delete("/jobs/{jid}")
def delete_job_route(jid: str):
    conn = get_connection()
    try:
        return {"deleted": jobs.delete_job(conn, jid)}
    finally:
        conn.close()
```

- [ ] **Step 4: Wire the router** — modify `webapp/backend/app/main.py`, replacing the router import block:

```python
    from app.api import routes_meta, routes_jobs
    app.include_router(routes_meta.router)
    app.include_router(routes_jobs.router)
    return app
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd webapp/backend && python -m pytest tests/test_api_jobs.py -v`
Expected: PASS (3 passed).

- [ ] **Step 6: Commit**

```bash
git add webapp/backend/app/api/routes_jobs.py webapp/backend/app/main.py webapp/backend/tests/test_api_jobs.py
git commit -m "feat(backend): jobs REST routes (upload/list/get/delete/cancel)"
```

---

### Task 9: Progress mapping (pure function)

**Files:**
- Create: `webapp/backend/app/worker/__init__.py`, `webapp/backend/app/worker/progress.py`, `webapp/backend/tests/test_progress.py`

**Interfaces:**
- Produces: `app.worker.progress.compute_progress(d: dict) -> tuple[float, str]`. Input is a Demucs callback dict with keys `model_idx_in_bag`, `shift_idx`, `segment_offset`, `audio_length`, `models`, `state`. Output: `(fraction in [0,1], human_stage)`. Pure — no torch.

- [ ] **Step 1: Write the failing test** — `webapp/backend/tests/test_progress.py`

```python
from app.worker.progress import compute_progress


def test_single_model_mid_segment():
    frac, stage = compute_progress(
        {"model_idx_in_bag": 0, "models": 1, "shift_idx": 0,
         "segment_offset": 5, "audio_length": 10, "state": "start"}
    )
    assert 0.49 <= frac <= 0.51
    assert stage == "model 1/1"


def test_bag_of_four_second_model():
    frac, _ = compute_progress(
        {"model_idx_in_bag": 1, "models": 4, "shift_idx": 0,
         "segment_offset": 0, "audio_length": 10, "state": "start"}
    )
    assert 0.24 <= frac <= 0.26  # 1/4 done


def test_clamped_and_safe_zero_length():
    frac, _ = compute_progress(
        {"model_idx_in_bag": 0, "models": 1, "shift_idx": 0,
         "segment_offset": 10, "audio_length": 0, "state": "end"}
    )
    assert frac == 0.0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd webapp/backend && python -m pytest tests/test_progress.py -v`
Expected: FAIL — cannot import `app.worker.progress`.

- [ ] **Step 3: Create `webapp/backend/app/worker/__init__.py`** (empty), then `webapp/backend/app/worker/progress.py`

```python
from __future__ import annotations

from typing import Tuple


def compute_progress(d: dict) -> Tuple[float, str]:
    models = max(int(d.get("models", 1)), 1)
    model_idx = int(d.get("model_idx_in_bag", 0))
    audio_length = float(d.get("audio_length", 0) or 0)
    segment_offset = float(d.get("segment_offset", 0) or 0)

    seg_frac = (segment_offset / audio_length) if audio_length > 0 else 0.0
    seg_frac = min(max(seg_frac, 0.0), 1.0)
    frac = (model_idx + seg_frac) / models
    frac = min(max(frac, 0.0), 1.0)
    return frac, f"model {model_idx + 1}/{models}"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd webapp/backend && python -m pytest tests/test_progress.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add webapp/backend/app/worker/__init__.py webapp/backend/app/worker/progress.py webapp/backend/tests/test_progress.py
git commit -m "feat(worker): pure progress mapping from demucs callback"
```

---

### Task 10: Stem/mixdown encoder

**Files:**
- Create: `webapp/backend/app/worker/encode.py`, `webapp/backend/tests/test_encode.py`

**Interfaces:**
- Consumes: `paths`. Imports `torch` + `demucs.api` + `soundfile` (worker side only).
- Produces: `app.worker.encode.save_stem(wav, path, samplerate, fmt, bitrate=320, bitdepth=16) -> None`. `wav` is a `torch.Tensor` shaped `(channels, samples)`. Writes `.wav` (int16/int24/float32 by bitdepth: 32 → float), `.mp3` (bitrate), `.flac` (via soundfile). `render_mixdown(...)` is added in M4.

- [ ] **Step 1: Write the failing test** — `webapp/backend/tests/test_encode.py`

```python
import pytest

torch = pytest.importorskip("torch")
sf = pytest.importorskip("soundfile")

from app.worker.encode import save_stem


@pytest.mark.integration
def test_save_wav_roundtrip(tmp_path):
    wav = torch.zeros(2, 4410)
    out = tmp_path / "vocals.wav"
    save_stem(wav, out, samplerate=44100, fmt="wav", bitdepth=16)
    data, sr = sf.read(str(out))
    assert sr == 44100 and data.shape[0] == 4410 and data.shape[1] == 2


@pytest.mark.integration
def test_save_flac_roundtrip(tmp_path):
    wav = torch.zeros(2, 4410)
    out = tmp_path / "vocals.flac"
    save_stem(wav, out, samplerate=44100, fmt="flac")
    data, sr = sf.read(str(out))
    assert sr == 44100 and data.shape[0] == 4410
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd webapp/backend && python -m pytest tests/test_encode.py -v -m integration`
Expected: FAIL — cannot import `app.worker.encode` (or skipped if torch absent; install torch to run).

- [ ] **Step 3: Create `webapp/backend/app/worker/encode.py`**

```python
from __future__ import annotations

from pathlib import Path

import soundfile as sf
import torch

import demucs.api
from app.core import paths


def save_stem(wav: torch.Tensor, path, samplerate: int, fmt: str,
              bitrate: int = 320, bitdepth: int = 16) -> None:
    path = Path(path)
    paths.ensure_parent(path)
    if fmt == "wav":
        demucs.api.save_audio(
            wav, str(path), samplerate=samplerate,
            bits_per_sample=24 if bitdepth == 24 else 16,
            as_float=(bitdepth == 32),
        )
    elif fmt == "mp3":
        demucs.api.save_audio(wav, str(path), samplerate=samplerate, bitrate=bitrate)
    elif fmt == "flac":
        # soundfile expects (frames, channels)
        sf.write(str(path), wav.t().cpu().numpy(), samplerate, format="FLAC")
    else:
        raise ValueError(f"Unsupported output format: {fmt}")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd webapp/backend && python -m pytest tests/test_encode.py -v -m integration`
Expected: PASS (2 passed) when torch is installed.

- [ ] **Step 5: Commit**

```bash
git add webapp/backend/app/worker/encode.py webapp/backend/tests/test_encode.py
git commit -m "feat(worker): stem encoder for wav/mp3/flac"
```

---

### Task 11: Separation engine (device detect, model cache, run)

**Files:**
- Create: `webapp/backend/app/worker/engine.py`, `webapp/backend/tests/test_engine.py`
- Create: `webapp/backend/tests/fixtures/make_clip.py` (generates `fixtures/clip.wav`)

**Interfaces:**
- Consumes: `progress.compute_progress`. Imports `torch` + `demucs.api` (worker side).
- Produces: `app.worker.engine` with `detect_device() -> str` (`"cuda"|"cpu"`), `class ModelCache(maxsize)` with `get(model_name, device) -> demucs.api.Separator` (LRU), `run_separation(*, source_path, model, device, on_progress, cache) -> tuple[dict[str, torch.Tensor], int]` returning `(stems, samplerate)`, with CUDA-OOM → segment-reduce → CPU fallback (full fallback logic completed in M2; M1 implements the happy path + device detect + cache).

- [ ] **Step 1: Write the failing test (unit; no torch needed)** — `webapp/backend/tests/test_engine.py`

```python
import sys
import types

from app.worker import engine


def test_detect_device_prefers_cuda(monkeypatch):
    fake_torch = types.SimpleNamespace(cuda=types.SimpleNamespace(is_available=lambda: True))
    monkeypatch.setitem(sys.modules, "torch", fake_torch)
    assert engine.detect_device() == "cuda"
    fake_torch.cuda.is_available = lambda: False
    assert engine.detect_device() == "cpu"


def test_model_cache_lru_evicts(monkeypatch):
    loaded = []

    def fake_loader(name, device):
        loaded.append(name)
        return f"sep:{name}:{device}"

    cache = engine.ModelCache(maxsize=2, loader=fake_loader)
    cache.get("a", "cpu")
    cache.get("b", "cpu")
    cache.get("a", "cpu")          # hit, no reload
    cache.get("c", "cpu")          # evicts b (LRU)
    cache.get("b", "cpu")          # reload b
    assert loaded == ["a", "b", "c", "b"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd webapp/backend && python -m pytest tests/test_engine.py -v`
Expected: FAIL — cannot import `app.worker.engine`.

- [ ] **Step 3: Create `webapp/backend/app/worker/engine.py`**

```python
from __future__ import annotations

from collections import OrderedDict
from typing import Callable, Dict, Optional, Tuple

from app.worker.progress import compute_progress


def detect_device() -> str:
    import torch

    return "cuda" if torch.cuda.is_available() else "cpu"


def _default_loader(model_name: str, device: str):
    import demucs.api

    return demucs.api.Separator(model=model_name, device=device)


class ModelCache:
    def __init__(self, maxsize: int = 2, loader: Optional[Callable] = None):
        self.maxsize = maxsize
        self.loader = loader or _default_loader
        self._items: "OrderedDict[tuple, object]" = OrderedDict()

    def get(self, model_name: str, device: str):
        key = (model_name, device)
        if key in self._items:
            self._items.move_to_end(key)
            return self._items[key]
        sep = self.loader(model_name, device)
        self._items[key] = sep
        self._items.move_to_end(key)
        while len(self._items) > self.maxsize:
            self._items.popitem(last=False)
        return sep


def run_separation(*, source_path: str, model: str, device: str,
                   on_progress: Callable[[float, str], None],
                   cache: ModelCache) -> Tuple[Dict[str, object], int]:
    separator = cache.get(model, device)

    def _cb(d: dict) -> None:
        if d.get("state") == "end":
            frac, stage = compute_progress(d)
            on_progress(frac, stage)

    separator.update_parameter(callback=_cb)
    _origin, separated = separator.separate_audio_file(source_path)
    return separated, separator.samplerate
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd webapp/backend && python -m pytest tests/test_engine.py -v`
Expected: PASS (2 passed).

- [ ] **Step 5: Create the test-clip generator** — `webapp/backend/tests/fixtures/make_clip.py`

```python
"""Generate a ~3s stereo 44.1k WAV fixture for integration tests."""
import wave
from pathlib import Path

OUT = Path(__file__).with_name("clip.wav")


def main() -> None:
    sr, secs = 44100, 3
    with wave.open(str(OUT), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(b"\x00\x00\x00\x00" * (sr * secs))
    print("wrote", OUT)


if __name__ == "__main__":
    main()
```

- [ ] **Step 6: Add an opt-in integration test** — append to `webapp/backend/tests/test_engine.py`

```python
import pytest
from pathlib import Path


@pytest.mark.integration
def test_run_separation_on_clip(tmp_path):
    pytest.importorskip("torch")
    pytest.importorskip("demucs.api")
    clip = Path(__file__).parent / "fixtures" / "clip.wav"
    if not clip.exists():
        pytest.skip("run fixtures/make_clip.py first")
    seen = []
    stems, sr = engine.run_separation(
        source_path=str(clip), model="htdemucs", device="cpu",
        on_progress=lambda f, s: seen.append(f), cache=engine.ModelCache(1),
    )
    assert set(stems.keys()) == {"drums", "bass", "other", "vocals"}
    assert sr == 44100 and seen and seen[-1] <= 1.0
```

- [ ] **Step 7: Commit**

```bash
git add webapp/backend/app/worker/engine.py webapp/backend/tests/test_engine.py webapp/backend/tests/fixtures/make_clip.py
git commit -m "feat(worker): separation engine with device detect and model LRU cache"
```

---

### Task 12: Worker loop

**Files:**
- Create: `webapp/backend/app/worker/__main__.py`, `webapp/backend/tests/test_worker_loop.py`

**Interfaces:**
- Consumes: `jobs`, `engine`, `encode`, `paths`, `compute_progress`, `get_settings`.
- Produces: `app.worker.__main__` with `process_one(conn, job, *, separate_fn, encode_fn, max_attempts) -> None` (testable, dependency-injected — no torch in the test) and `main()` (the real loop: recover, heartbeat, claim, process). `separate_fn(job, on_progress) -> (stems_dict, samplerate)`; `encode_fn(job, stems, samplerate) -> dict[str, str]` (returns `{stem: relative_path}`).

- [ ] **Step 1: Write the failing test** — `webapp/backend/tests/test_worker_loop.py`

```python
from app.core import jobs
from app.core.schemas import JobCreate
from app.worker.__main__ import process_one


def _queued(conn):
    return jobs.create_job(
        conn, source_filename="s.wav", source_path="/tmp/s.wav",
        source_format="wav", source_duration=1.0, source_bytes=1, spec=JobCreate(),
    )


def test_process_one_success(conn):
    _queued(conn)
    job = jobs.claim_next(conn, "cpu")

    def fake_separate(job, on_progress):
        on_progress(0.5, "model 1/1")
        return {"vocals": object()}, 44100

    def fake_encode(job, stems, sr):
        return {"vocals": f"stems/{job.id}/vocals.wav"}

    process_one(conn, job, separate_fn=fake_separate, encode_fn=fake_encode, max_attempts=1)
    done = jobs.get_job(conn, job.id)
    assert done.status == "done"
    assert done.stems["vocals"].endswith("vocals.wav")


def test_process_one_failure_requeues(conn):
    _queued(conn)
    job = jobs.claim_next(conn, "cpu")  # attempts=1

    def boom(job, on_progress):
        raise RuntimeError("kaboom")

    process_one(conn, job, separate_fn=boom, encode_fn=lambda *a: {}, max_attempts=1)
    assert jobs.get_job(conn, job.id).status == "queued"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd webapp/backend && python -m pytest tests/test_worker_loop.py -v`
Expected: FAIL — cannot import `app.worker.__main__`.

- [ ] **Step 3: Create `webapp/backend/app/worker/__main__.py`**

```python
from __future__ import annotations

import time
from datetime import datetime, timezone

from app.config import get_settings
from app.core import jobs, paths
from app.core.db import get_connection, init_db


def process_one(conn, job, *, separate_fn, encode_fn, max_attempts) -> None:
    try:
        def on_progress(frac, stage):
            jobs.update_progress(conn, job.id, frac, stage)

        stems, samplerate = separate_fn(job, on_progress)
        stem_paths = encode_fn(job, stems, samplerate)
        jobs.finish_job(conn, job.id, stem_paths)
    except Exception as e:  # noqa: BLE001 — record any failure on the job
        jobs.fail_or_requeue(conn, job.id, f"{type(e).__name__}: {e}", max_attempts)


def _real_separate(cache):
    from app.worker import engine

    def fn(job, on_progress):
        return engine.run_separation(
            source_path=job.source_path, model=job.model,
            device=job.device_used or engine.detect_device(),
            on_progress=on_progress, cache=cache,
        )

    return fn


def _real_encode(job, stems, samplerate):
    from app.worker.encode import save_stem

    fmt = job.output_format
    wanted = set(job.requested_stems) if job.requested_stems else None
    out = {}
    for name, wav in stems.items():
        if wanted and name not in wanted:
            continue
        p = paths.stem_path(job.id, name, fmt)
        save_stem(wav, p, samplerate=samplerate, fmt=fmt,
                  bitrate=job.output_bitrate or 320, bitdepth=job.output_bitdepth or 16)
        out[name] = str(p.relative_to(get_settings().data_dir))
    return out


def main() -> None:
    from app.worker import engine

    settings = get_settings()
    init_db()
    conn = get_connection()
    cache = engine.ModelCache(maxsize=settings.model_cache_size)
    separate_fn = _real_separate(cache)

    jobs.recover_stuck(conn, settings.max_attempts)
    device = engine.detect_device()
    jobs.set_meta(conn, "device", device)
    print(f"[worker] started on device={device}")

    while True:
        jobs.set_meta(conn, "worker_heartbeat", datetime.now(timezone.utc).isoformat())
        job = jobs.claim_next(conn, device)
        if job is None:
            time.sleep(settings.worker_poll_interval)
            continue
        print(f"[worker] processing {job.id} ({job.source_filename})")
        process_one(conn, job, separate_fn=separate_fn, encode_fn=_real_encode,
                    max_attempts=settings.max_attempts)


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd webapp/backend && python -m pytest tests/test_worker_loop.py -v`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add webapp/backend/app/worker/__main__.py webapp/backend/tests/test_worker_loop.py
git commit -m "feat(worker): claim/process loop with heartbeat and recovery"
```

---

### Task 13: SSE progress stream

**Files:**
- Create: `webapp/backend/app/api/sse.py`, `webapp/backend/tests/test_api_sse.py`
- Modify: `webapp/backend/app/main.py` (include router)

**Interfaces:**
- Consumes: `jobs.get_job`, `get_settings`.
- Produces: `app.api.sse` with `async def job_event_stream(get_job_fn, jid, *, poll_interval, sleep_fn=asyncio.sleep) -> AsyncIterator[str]` (yields SSE-formatted strings; emits on change; terminal events `done`/`error`/`canceled` close the stream) and route `GET /api/jobs/{id}/events` (returns `text/event-stream`).

- [ ] **Step 1: Write the failing test** — `webapp/backend/tests/test_api_sse.py`

```python
import asyncio

from app.api.sse import job_event_stream
from app.core.schemas import JobOut


def _job(status, progress, stage=None, stems=None, err=None):
    return JobOut(
        id="j", created_at="t", updated_at="t", status=status, attempts=1,
        source_filename="s.wav", model="htdemucs", output_format="wav",
        progress=progress, progress_stage=stage, stems=stems, error_message=err,
    )


def test_stream_emits_progress_then_done():
    seq = [
        _job("running", 0.0, "model 1/1"),
        _job("running", 0.5, "model 1/1"),
        _job("done", 1.0, stems={"vocals": "p"}),
    ]
    calls = {"i": 0}

    def get_job_fn(jid):
        i = min(calls["i"], len(seq) - 1)
        calls["i"] += 1
        return seq[i]

    async def fake_sleep(_):
        return None

    async def run():
        out = []
        async for chunk in job_event_stream(get_job_fn, "j", poll_interval=0,
                                            sleep_fn=fake_sleep):
            out.append(chunk)
        return out

    chunks = asyncio.run(run())
    joined = "".join(chunks)
    assert "event: progress" in joined
    assert "event: done" in joined
    assert joined.count("event: progress") >= 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd webapp/backend && python -m pytest tests/test_api_sse.py -v`
Expected: FAIL — cannot import `app.api.sse`.

- [ ] **Step 3: Create `webapp/backend/app/api/sse.py`**

```python
from __future__ import annotations

import asyncio
import json
from typing import AsyncIterator, Callable

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from app.config import get_settings
from app.core import jobs
from app.core.db import get_connection

router = APIRouter(prefix="/api")

TERMINAL = {"done", "failed", "canceled"}


def _format(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


async def job_event_stream(get_job_fn: Callable, jid: str, *, poll_interval: float,
                           sleep_fn=asyncio.sleep) -> AsyncIterator[str]:
    last = None
    while True:
        job = get_job_fn(jid)
        if job is None:
            yield _format("error", {"status": "failed", "message": "Job not found"})
            return
        snapshot = (job.status, round(job.progress, 4), job.progress_stage)
        if snapshot != last:
            last = snapshot
            if job.status in TERMINAL:
                if job.status == "done":
                    yield _format("done", {"status": "done", "stems": job.stems or {}})
                elif job.status == "failed":
                    yield _format("error", {"status": "failed", "message": job.error_message})
                else:
                    yield _format("canceled", {"status": "canceled"})
                return
            yield _format("progress", {
                "status": job.status, "progress": job.progress,
                "stage": job.progress_stage, "device": job.device_used,
            })
        await sleep_fn(poll_interval)


@router.get("/jobs/{jid}/events")
async def job_events(jid: str):
    settings = get_settings()

    def get_job_fn(job_id):
        conn = get_connection()
        try:
            return jobs.get_job(conn, job_id)
        finally:
            conn.close()

    if get_job_fn(jid) is None:
        raise HTTPException(404, "Job not found")

    return StreamingResponse(
        job_event_stream(get_job_fn, jid, poll_interval=settings.sse_poll_interval),
        media_type="text/event-stream",
    )
```

- [ ] **Step 4: Wire the router** — modify `webapp/backend/app/main.py` router block:

```python
    from app.api import routes_meta, routes_jobs, sse
    app.include_router(routes_meta.router)
    app.include_router(routes_jobs.router)
    app.include_router(sse.router)
    return app
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd webapp/backend && python -m pytest tests/test_api_sse.py -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add webapp/backend/app/api/sse.py webapp/backend/app/main.py webapp/backend/tests/test_api_sse.py
git commit -m "feat(backend): SSE progress stream for jobs"
```

---

### Task 14: Stem download route

**Files:**
- Create: `webapp/backend/app/api/routes_stems.py`, `webapp/backend/tests/test_api_stems.py`
- Modify: `webapp/backend/app/main.py` (include router)

**Interfaces:**
- Consumes: `jobs.get_job`, `paths`, `get_settings`.
- Produces: route `GET /api/jobs/{id}/stems/{stem}` → `FileResponse` (supports HTTP range for the player), 404 if job/stem missing.

- [ ] **Step 1: Write the failing test** — `webapp/backend/tests/test_api_stems.py`

```python
from fastapi.testclient import TestClient

from app.core import jobs, paths
from app.core.db import get_connection, init_db
from app.core.schemas import JobCreate
from app.main import create_app


def test_download_stem(settings):
    init_db()
    conn = get_connection()
    job = jobs.create_job(
        conn, source_filename="s.wav", source_path="/tmp/s.wav",
        source_format="wav", source_duration=1.0, source_bytes=1, spec=JobCreate(),
    )
    p = paths.ensure_parent(paths.stem_path(job.id, "vocals", "wav"))
    p.write_bytes(b"RIFFDATA")
    rel = str(p.relative_to(settings.data_dir))
    jobs.finish_job(conn, job.id, {"vocals": rel})
    conn.close()

    client = TestClient(create_app())
    r = client.get(f"/api/jobs/{job.id}/stems/vocals")
    assert r.status_code == 200 and r.content == b"RIFFDATA"
    assert client.get(f"/api/jobs/{job.id}/stems/bass").status_code == 404
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd webapp/backend && python -m pytest tests/test_api_stems.py -v`
Expected: FAIL — cannot import `app.api.routes_stems`.

- [ ] **Step 3: Create `webapp/backend/app/api/routes_stems.py`**

```python
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from app.config import get_settings
from app.core import jobs
from app.core.db import get_connection

router = APIRouter(prefix="/api")


@router.get("/jobs/{jid}/stems/{stem}")
def get_stem(jid: str, stem: str):
    conn = get_connection()
    try:
        job = jobs.get_job(conn, jid)
    finally:
        conn.close()
    if not job or not job.stems or stem not in job.stems:
        raise HTTPException(404, "Stem not found")
    full = get_settings().data_dir / job.stems[stem]
    if not full.exists():
        raise HTTPException(404, "Stem file missing")
    return FileResponse(str(full), filename=full.name)
```

- [ ] **Step 4: Wire the router** — modify `webapp/backend/app/main.py` router block:

```python
    from app.api import routes_meta, routes_jobs, routes_stems, sse
    app.include_router(routes_meta.router)
    app.include_router(routes_jobs.router)
    app.include_router(routes_stems.router)
    app.include_router(sse.router)
    return app
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd webapp/backend && python -m pytest tests/test_api_stems.py -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add webapp/backend/app/api/routes_stems.py webapp/backend/app/main.py webapp/backend/tests/test_api_stems.py
git commit -m "feat(backend): stem download route"
```

**Backend checkpoint:** run the whole suite — `cd webapp/backend && python -m pytest -q` (skip integration with `-m "not integration"`). Then manually: start worker (`python -m app.worker`) + API (`uvicorn app.main:app`), POST a real song to `/api/jobs`, watch progress at `/api/jobs/{id}/events`, download stems.

---

### Task 15: Frontend scaffold + types + API client

**Files:**
- Create: `webapp/frontend/package.json`, `vite.config.ts`, `tsconfig.json`, `vitest.config.ts`, `index.html`, `src/main.tsx`, `src/App.tsx`, `src/types.ts`, `src/api/client.ts`, `src/api/__tests__/client.test.ts`

**Interfaces:**
- Produces: `src/types.ts` (`Job`, `JobStatus`, `ModelInfo`, `MixdownRequest`, `MixdownTrack` mirroring backend schemas); `src/api/client.ts` with `listModels()`, `createJob(file, opts)`, `listJobs(params?)`, `getJob(id)`, `deleteJob(id)`, `cancelJob(id)`, `stemUrl(id, stem)`, `health()`. Base URL `/api` (Vite proxy).

- [ ] **Step 1: Create `webapp/frontend/package.json`**

```json
{
  "name": "demucs-stem-studio-frontend",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "wavesurfer.js": "^7.8.0",
    "zustand": "^4.5.5"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.4.8",
    "@testing-library/react": "^16.0.1",
    "@types/react": "^18.3.5",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "jsdom": "^25.0.0",
    "typescript": "^5.5.4",
    "vite": "^5.4.2",
    "vitest": "^2.0.5"
  }
}
```

- [ ] **Step 2: Create config files**

`webapp/frontend/vite.config.ts`:
```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { proxy: { "/api": "http://localhost:8000" } },
});
```

`webapp/frontend/vitest.config.ts`:
```typescript
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: { environment: "jsdom", globals: true, setupFiles: [] },
});
```

`webapp/frontend/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true,
    "types": ["vitest/globals", "node"]
  },
  "include": ["src"]
}
```

`webapp/frontend/index.html`:
```html
<!doctype html>
<html lang="en">
  <head><meta charset="UTF-8" /><title>Demucs Stem Studio</title></head>
  <body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body>
</html>
```

- [ ] **Step 3: Write the failing test** — `webapp/frontend/src/api/__tests__/client.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as client from "../client";

describe("api client", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("createJob posts multipart to /api/jobs", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "x", status: "queued" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const file = new File([new Uint8Array([1, 2, 3])], "song.mp3");
    const job = await client.createJob(file, { model: "htdemucs", output_format: "wav" });
    expect(job.id).toBe("x");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/jobs");
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
  });

  it("stemUrl builds the download path", () => {
    expect(client.stemUrl("abc", "vocals")).toBe("/api/jobs/abc/stems/vocals");
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd webapp/frontend && npm install && npm test`
Expected: FAIL — cannot resolve `../client`.

- [ ] **Step 5: Create `webapp/frontend/src/types.ts`**

```typescript
export type JobStatus = "queued" | "running" | "done" | "failed" | "canceled";
export type OutputFormat = "wav" | "flac" | "mp3";

export interface Job {
  id: string;
  batch_id?: string | null;
  status: JobStatus;
  source_filename: string;
  source_duration?: number | null;
  model: string;
  output_format: OutputFormat;
  progress: number;
  progress_stage?: string | null;
  device_used?: string | null;
  stems?: Record<string, string> | null;
  error_message?: string | null;
}

export interface ModelInfo {
  name: string;
  stems: string[];
  description: string;
}

export interface CreateJobOpts {
  model: string;
  output_format: OutputFormat;
  output_bitrate?: number;
  output_bitdepth?: number;
  stems?: string[];
  batch_id?: string;
}

export interface MixdownTrack {
  stem: string;
  gain: number;
  muted: boolean;
}

export interface MixdownRequest {
  name: string;
  format: OutputFormat;
  bitrate?: number;
  bitdepth?: number;
  tracks: MixdownTrack[];
}
```

- [ ] **Step 6: Create `webapp/frontend/src/api/client.ts`**

```typescript
import type { CreateJobOpts, Job, ModelInfo } from "../types";

const BASE = "/api";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export async function health() {
  return json<{ db: boolean; ffmpeg: boolean; worker_alive: boolean; device?: string }>(
    await fetch(`${BASE}/health`),
  );
}

export async function listModels(): Promise<ModelInfo[]> {
  return json(await fetch(`${BASE}/models`));
}

export async function createJob(file: File, opts: CreateJobOpts): Promise<Job> {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("model", opts.model);
  fd.append("output_format", opts.output_format);
  if (opts.output_bitrate != null) fd.append("output_bitrate", String(opts.output_bitrate));
  if (opts.output_bitdepth != null) fd.append("output_bitdepth", String(opts.output_bitdepth));
  if (opts.stems?.length) fd.append("stems", opts.stems.join(","));
  if (opts.batch_id) fd.append("batch_id", opts.batch_id);
  return json(await fetch(`${BASE}/jobs`, { method: "POST", body: fd }));
}

export async function listJobs(params?: { status?: string; batch_id?: string }): Promise<Job[]> {
  const q = new URLSearchParams(params as Record<string, string>).toString();
  return json(await fetch(`${BASE}/jobs${q ? `?${q}` : ""}`));
}

export async function getJob(id: string): Promise<Job> {
  return json(await fetch(`${BASE}/jobs/${id}`));
}

export async function deleteJob(id: string): Promise<{ deleted: boolean }> {
  return json(await fetch(`${BASE}/jobs/${id}`, { method: "DELETE" }));
}

export async function cancelJob(id: string): Promise<Job> {
  return json(await fetch(`${BASE}/jobs/${id}/cancel`, { method: "POST" }));
}

export function stemUrl(id: string, stem: string): string {
  return `${BASE}/jobs/${id}/stems/${stem}`;
}
```

- [ ] **Step 7: Create `webapp/frontend/src/main.tsx` and `src/App.tsx`** (minimal shell; expanded in later tasks)

`src/main.tsx`:
```typescript
import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(<App />);
```

`src/App.tsx`:
```typescript
import React from "react";

export function App() {
  return <h1>Demucs Stem Studio</h1>;
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `cd webapp/frontend && npm test`
Expected: PASS (2 passed).

- [ ] **Step 9: Commit**

```bash
git add webapp/frontend
git commit -m "feat(frontend): scaffold, types, and API client"
```

---

### Task 16: SSE hook + Job Dashboard (minimal)

**Files:**
- Create: `webapp/frontend/src/api/sse.ts`, `webapp/frontend/src/screens/Dashboard.tsx`, `webapp/frontend/src/screens/__tests__/Dashboard.test.tsx`

**Interfaces:**
- Consumes: `client`, `types`.
- Produces: `src/api/sse.ts` `subscribeJob(id, handlers) -> () => void` (wraps `EventSource` on `/api/jobs/{id}/events`, dispatches `onProgress`/`onDone`/`onError`); `src/screens/Dashboard.tsx` `<Dashboard jobs={Job[]} />` rendering each job's filename, status, and a progress bar (width = `progress*100%`), plus a download link list when `done`.

- [ ] **Step 1: Write the failing test** — `webapp/frontend/src/screens/__tests__/Dashboard.test.tsx`

```typescript
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Dashboard } from "../Dashboard";
import type { Job } from "../../types";

const base: Job = {
  id: "j1", status: "running", source_filename: "song.mp3",
  model: "htdemucs", output_format: "wav", progress: 0.42,
};

describe("Dashboard", () => {
  it("shows filename, status and progress", () => {
    render(<Dashboard jobs={[base]} />);
    expect(screen.getByText("song.mp3")).toBeTruthy();
    expect(screen.getByText(/running/i)).toBeTruthy();
    expect(screen.getByTestId("progress-j1").style.width).toBe("42%");
  });

  it("renders stem download links when done", () => {
    const done: Job = { ...base, status: "done", progress: 1, stems: { vocals: "p", drums: "p" } };
    render(<Dashboard jobs={[done]} />);
    expect(screen.getByText("vocals")).toBeTruthy();
    expect(screen.getByText("drums")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd webapp/frontend && npm test -- Dashboard`
Expected: FAIL — cannot resolve `../Dashboard`.

- [ ] **Step 3: Create `webapp/frontend/src/api/sse.ts`**

```typescript
export interface JobHandlers {
  onProgress?: (d: { progress: number; stage?: string; device?: string }) => void;
  onDone?: (d: { stems: Record<string, string> }) => void;
  onError?: (d: { message?: string }) => void;
}

export function subscribeJob(id: string, h: JobHandlers): () => void {
  const es = new EventSource(`/api/jobs/${id}/events`);
  es.addEventListener("progress", (e) => h.onProgress?.(JSON.parse((e as MessageEvent).data)));
  es.addEventListener("done", (e) => {
    h.onDone?.(JSON.parse((e as MessageEvent).data));
    es.close();
  });
  es.addEventListener("error", (e) => {
    // EventSource fires a generic error on disconnect with no data
    const data = (e as MessageEvent).data;
    if (data) h.onError?.(JSON.parse(data));
  });
  es.addEventListener("canceled", () => es.close());
  return () => es.close();
}
```

- [ ] **Step 4: Create `webapp/frontend/src/screens/Dashboard.tsx`**

```typescript
import React from "react";
import type { Job } from "../types";
import { stemUrl } from "../api/client";

export function Dashboard({ jobs }: { jobs: Job[] }) {
  return (
    <div>
      {jobs.map((j) => (
        <div key={j.id} className="job-card">
          <div className="job-head">
            <strong>{j.source_filename}</strong>
            <span className="status">{j.status}</span>
            {j.device_used && <span className="device">{j.device_used}</span>}
          </div>
          <div className="progress-track">
            <div
              data-testid={`progress-${j.id}`}
              className="progress-fill"
              style={{ width: `${Math.round(j.progress * 100)}%` }}
            />
          </div>
          {j.status === "done" && j.stems && (
            <div className="downloads">
              {Object.keys(j.stems).map((stem) => (
                <a key={stem} href={stemUrl(j.id, stem)} download>
                  {stem}
                </a>
              ))}
            </div>
          )}
          {j.status === "failed" && <div className="error">{j.error_message}</div>}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd webapp/frontend && npm test -- Dashboard`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add webapp/frontend/src/api/sse.ts webapp/frontend/src/screens/Dashboard.tsx webapp/frontend/src/screens/__tests__/Dashboard.test.tsx
git commit -m "feat(frontend): SSE hook and job dashboard"
```

---

### Task 17: Upload screen + app wiring (vertical slice complete)

**Files:**
- Create: `webapp/frontend/src/screens/Upload.tsx`, `webapp/frontend/src/store.ts`, `webapp/frontend/src/screens/__tests__/Upload.test.tsx`
- Modify: `webapp/frontend/src/App.tsx`
- Create: `webapp/scripts/run-dev.ps1`, `webapp/scripts/run-dev.sh`, `webapp/.gitignore`

**Interfaces:**
- Consumes: `client.createJob`, `client.listModels`, `subscribeJob`, `Dashboard`.
- Produces: `src/store.ts` Zustand store `{ jobs: Job[]; upsertJob(j); setProgress(id, p, stage, device) }`; `<Upload onCreated={(job)=>void} />` (file input + model select + format select → `createJob`); `App` composes Upload + Dashboard and subscribes to active jobs via SSE.

- [ ] **Step 1: Write the failing test** — `webapp/frontend/src/screens/__tests__/Upload.test.tsx`

```typescript
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { Upload } from "../Upload";
import * as client from "../../api/client";

describe("Upload", () => {
  it("uploads selected file and reports created job", async () => {
    vi.spyOn(client, "listModels").mockResolvedValue([
      { name: "htdemucs", stems: ["drums", "bass", "other", "vocals"], description: "" },
    ]);
    const created = vi.fn();
    vi.spyOn(client, "createJob").mockResolvedValue({
      id: "j1", status: "queued", source_filename: "song.mp3",
      model: "htdemucs", output_format: "wav", progress: 0,
    });
    render(<Upload onCreated={created} />);
    const file = new File([new Uint8Array([1])], "song.mp3");
    const input = screen.getByTestId("file-input") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.click(screen.getByText(/separate/i));
    await waitFor(() => expect(created).toHaveBeenCalledWith(expect.objectContaining({ id: "j1" })));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd webapp/frontend && npm test -- Upload`
Expected: FAIL — cannot resolve `../Upload`.

- [ ] **Step 3: Create `webapp/frontend/src/store.ts`**

```typescript
import { create } from "zustand";
import type { Job } from "./types";

interface State {
  jobs: Job[];
  upsertJob: (j: Job) => void;
  setProgress: (id: string, progress: number, stage?: string, device?: string) => void;
}

export const useStore = create<State>((set) => ({
  jobs: [],
  upsertJob: (j) =>
    set((s) => {
      const i = s.jobs.findIndex((x) => x.id === j.id);
      if (i === -1) return { jobs: [j, ...s.jobs] };
      const jobs = [...s.jobs];
      jobs[i] = { ...jobs[i], ...j };
      return { jobs };
    }),
  setProgress: (id, progress, stage, device) =>
    set((s) => ({
      jobs: s.jobs.map((j) =>
        j.id === id ? { ...j, progress, progress_stage: stage, device_used: device, status: "running" } : j,
      ),
    })),
}));
```

- [ ] **Step 4: Create `webapp/frontend/src/screens/Upload.tsx`**

```typescript
import React, { useEffect, useState } from "react";
import { createJob, listModels } from "../api/client";
import type { Job, ModelInfo, OutputFormat } from "../types";

export function Upload({ onCreated }: { onCreated: (j: Job) => void }) {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [model, setModel] = useState("htdemucs");
  const [format, setFormat] = useState<OutputFormat>("wav");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    listModels().then(setModels).catch(() => setModels([]));
  }, []);

  async function submit() {
    if (!file) return;
    setBusy(true);
    try {
      onCreated(await createJob(file, { model, output_format: format }));
      setFile(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="upload">
      <input
        data-testid="file-input"
        type="file"
        accept=".mp3,.flac,.wav,.ogg,.m4a"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />
      <select value={model} onChange={(e) => setModel(e.target.value)}>
        {models.map((m) => (
          <option key={m.name} value={m.name}>{m.name}</option>
        ))}
      </select>
      <select value={format} onChange={(e) => setFormat(e.target.value as OutputFormat)}>
        <option value="wav">WAV</option>
        <option value="flac">FLAC</option>
        <option value="mp3">MP3</option>
      </select>
      <button onClick={submit} disabled={!file || busy}>Separate</button>
    </div>
  );
}
```

- [ ] **Step 5: Update `webapp/frontend/src/App.tsx`** to wire everything

```typescript
import React, { useEffect } from "react";
import { Upload } from "./screens/Upload";
import { Dashboard } from "./screens/Dashboard";
import { useStore } from "./store";
import { subscribeJob } from "./api/sse";
import { getJob } from "./api/client";

export function App() {
  const jobs = useStore((s) => s.jobs);
  const upsertJob = useStore((s) => s.upsertJob);
  const setProgress = useStore((s) => s.setProgress);

  useEffect(() => {
    const unsubs = jobs
      .filter((j) => j.status === "queued" || j.status === "running")
      .map((j) =>
        subscribeJob(j.id, {
          onProgress: (d) => setProgress(j.id, d.progress, d.stage, d.device),
          onDone: async () => upsertJob(await getJob(j.id)),
          onError: async () => upsertJob(await getJob(j.id)),
        }),
      );
    return () => unsubs.forEach((u) => u());
  }, [jobs.map((j) => `${j.id}:${j.status}`).join(",")]);

  return (
    <div className="app">
      <h1>Demucs Stem Studio</h1>
      <Upload onCreated={upsertJob} />
      <Dashboard jobs={jobs} />
    </div>
  );
}
```

- [ ] **Step 6: Create `webapp/.gitignore` and dev scripts**

`webapp/.gitignore`:
```
data/
frontend/node_modules/
frontend/dist/
backend/.venv/
__pycache__/
*.pyc
```

`webapp/scripts/run-dev.ps1`:
```powershell
# Run backend API, worker, and frontend dev server together (Windows).
$root = Split-Path $PSScriptRoot -Parent
Start-Process powershell -ArgumentList "-NoExit","-Command","cd '$root/backend'; uvicorn app.main:app --reload --port 8000"
Start-Process powershell -ArgumentList "-NoExit","-Command","cd '$root/backend'; python -m app.worker"
Start-Process powershell -ArgumentList "-NoExit","-Command","cd '$root/frontend'; npm run dev"
```

`webapp/scripts/run-dev.sh`:
```bash
#!/usr/bin/env bash
set -e
root="$(cd "$(dirname "$0")/.." && pwd)"
( cd "$root/backend" && uvicorn app.main:app --reload --port 8000 ) &
( cd "$root/backend" && python -m app.worker ) &
( cd "$root/frontend" && npm run dev ) &
wait
```

- [ ] **Step 7: Run test to verify it passes**

Run: `cd webapp/frontend && npm test`
Expected: PASS (all suites).

- [ ] **Step 8: Commit**

```bash
git add webapp/frontend webapp/scripts webapp/.gitignore
git commit -m "feat(frontend): upload screen, store, app wiring, dev scripts"
```

**M1 demo (the whole point):** run `webapp/scripts/run-dev.ps1`, open the Vite URL, drop in a FLAC/MP3, watch the live progress bar, and download the separated stems. End-to-end vertical slice works.

---

## Phase M2 — Options & robustness

Goal: full model/format/quality/stem control, and a separation pipeline that survives CUDA out-of-memory.

### Task 18: CUDA-OOM resilient separation

**Files:**
- Modify: `webapp/backend/app/worker/engine.py` (add `run_separation_resilient`)
- Modify: `webapp/backend/app/worker/__main__.py` (`_real_separate` uses the resilient path)
- Create: `webapp/backend/tests/test_engine_resilient.py`

**Interfaces:**
- Produces: `engine.run_separation_resilient(*, source_path, model, device, on_progress, cache, segments=(None, 12, 8)) -> tuple[dict, int, str]` returning `(stems, samplerate, device_used)`. On a CUDA `RuntimeError` containing "out of memory", it lowers `segment` through the list; if all CUDA attempts fail it retries once on CPU. The final `device_used` reflects what actually ran.

- [ ] **Step 1: Write the failing test** — `webapp/backend/tests/test_engine_resilient.py`

```python
import pytest

from app.worker import engine


class FakeSep:
    def __init__(self, fail_times):
        self.fail_times = fail_times
        self.calls = 0
        self.samplerate = 44100

    def update_parameter(self, **kw):
        pass

    def separate_audio_file(self, path):
        self.calls += 1
        if self.calls <= self.fail_times:
            raise RuntimeError("CUDA error: out of memory")
        return None, {"vocals": object()}


def test_falls_back_to_cpu_after_cuda_oom(monkeypatch):
    seps = {"cuda": FakeSep(fail_times=99), "cpu": FakeSep(fail_times=0)}

    class Cache:
        def get(self, model, device):
            return seps[device]

    stems, sr, used = engine.run_separation_resilient(
        source_path="x.wav", model="htdemucs", device="cuda",
        on_progress=lambda f, s: None, cache=Cache(), segments=(None, 8),
    )
    assert used == "cpu" and sr == 44100 and "vocals" in stems


def test_succeeds_on_cuda_with_smaller_segment(monkeypatch):
    cuda = FakeSep(fail_times=1)  # first (full segment) fails, second (smaller) ok

    class Cache:
        def get(self, model, device):
            return cuda

    stems, sr, used = engine.run_separation_resilient(
        source_path="x.wav", model="htdemucs", device="cuda",
        on_progress=lambda f, s: None, cache=Cache(), segments=(None, 8),
    )
    assert used == "cuda" and cuda.calls == 2
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd webapp/backend && python -m pytest tests/test_engine_resilient.py -v`
Expected: FAIL — `run_separation_resilient` does not exist.

- [ ] **Step 3: Add to `webapp/backend/app/worker/engine.py`**

```python
def _is_oom(err: Exception) -> bool:
    return "out of memory" in str(err).lower()


def _empty_cuda_cache() -> None:
    try:
        import torch

        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except Exception:
        pass


def run_separation_resilient(*, source_path, model, device, on_progress, cache,
                             segments=(None, 12, 8)):
    devices = [device, "cpu"] if device == "cuda" else ["cpu"]
    last_err = None
    for dev in devices:
        seg_list = segments if dev == "cuda" else (None,)
        for seg in seg_list:
            separator = cache.get(model, dev)

            def _cb(d: dict) -> None:
                if d.get("state") == "end":
                    frac, stage = compute_progress(d)
                    on_progress(frac, stage)

            kwargs = {"callback": _cb}
            if seg is not None:
                kwargs["segment"] = seg
            separator.update_parameter(**kwargs)
            try:
                _origin, separated = separator.separate_audio_file(source_path)
                return separated, separator.samplerate, dev
            except RuntimeError as e:  # noqa: PERF203
                last_err = e
                if not _is_oom(e):
                    raise
                _empty_cuda_cache()
    raise RuntimeError(f"Separation failed after OOM fallbacks: {last_err}")
```

- [ ] **Step 4: Point the worker at the resilient path** — in `webapp/backend/app/worker/__main__.py`, replace `_real_separate`:

```python
def _real_separate(cache):
    from app.worker import engine

    def fn(job, on_progress):
        stems, sr, used = engine.run_separation_resilient(
            source_path=job.source_path, model=job.model,
            device=job.device_used or engine.detect_device(),
            on_progress=on_progress, cache=cache,
        )
        return stems, sr

    return fn
```

(Device-used recording is acceptable as the claimed device for M2; the resilient
return value can be surfaced later if desired.)

- [ ] **Step 5: Run test to verify it passes**

Run: `cd webapp/backend && python -m pytest tests/test_engine_resilient.py -v`
Expected: PASS (2 passed).

- [ ] **Step 6: Commit**

```bash
git add webapp/backend/app/worker/engine.py webapp/backend/app/worker/__main__.py webapp/backend/tests/test_engine_resilient.py
git commit -m "feat(worker): CUDA-OOM resilient separation with segment reduction and CPU fallback"
```

---

### Task 19: Advanced upload options (quality + stem subset)

**Files:**
- Modify: `webapp/frontend/src/screens/Upload.tsx`
- Modify: `webapp/frontend/src/screens/__tests__/Upload.test.tsx`

**Interfaces:**
- Consumes: `listModels` (to show the selected model's stems as toggleable checkboxes), `createJob` with `output_bitrate` / `output_bitdepth` / `stems`.
- Produces: Upload now exposes: MP3 bitrate select (when format=mp3), WAV bit-depth select (when format=wav), and a stem checklist (default all checked) sent as `stems`. Passing all stems sends `stems` omitted/empty (keep all).

- [ ] **Step 1: Extend the failing test** — add to `webapp/frontend/src/screens/__tests__/Upload.test.tsx`

```typescript
it("sends only the chosen stem subset", async () => {
  vi.spyOn(client, "listModels").mockResolvedValue([
    { name: "htdemucs", stems: ["drums", "bass", "other", "vocals"], description: "" },
  ]);
  const create = vi.spyOn(client, "createJob").mockResolvedValue({
    id: "j2", status: "queued", source_filename: "s.mp3",
    model: "htdemucs", output_format: "wav", progress: 0,
  });
  render(<Upload onCreated={vi.fn()} />);
  await screen.findByLabelText("vocals");
  fireEvent.click(screen.getByLabelText("drums")); // uncheck drums
  fireEvent.change(screen.getByTestId("file-input"), {
    target: { files: [new File([new Uint8Array([1])], "s.mp3")] },
  });
  fireEvent.click(screen.getByText(/separate/i));
  await waitFor(() => expect(create).toHaveBeenCalled());
  const opts = create.mock.calls[0][1];
  expect(opts.stems).toEqual(["bass", "other", "vocals"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd webapp/frontend && npm test -- Upload`
Expected: FAIL — no stem checkboxes / subset not sent.

- [ ] **Step 3: Replace `webapp/frontend/src/screens/Upload.tsx`**

```typescript
import React, { useEffect, useMemo, useState } from "react";
import { createJob, listModels } from "../api/client";
import type { Job, ModelInfo, OutputFormat } from "../types";

export function Upload({ onCreated }: { onCreated: (j: Job) => void }) {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [model, setModel] = useState("htdemucs");
  const [format, setFormat] = useState<OutputFormat>("wav");
  const [bitrate, setBitrate] = useState(320);
  const [bitdepth, setBitdepth] = useState(16);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    listModels().then(setModels).catch(() => setModels([]));
  }, []);

  const stems = useMemo(
    () => models.find((m) => m.name === model)?.stems ?? [],
    [models, model],
  );

  useEffect(() => {
    setSelected(Object.fromEntries(stems.map((s) => [s, true])));
  }, [stems.join(",")]);

  async function submit() {
    if (!file) return;
    setBusy(true);
    try {
      const chosen = stems.filter((s) => selected[s]);
      const allChosen = chosen.length === stems.length;
      onCreated(
        await createJob(file, {
          model,
          output_format: format,
          output_bitrate: format === "mp3" ? bitrate : undefined,
          output_bitdepth: format === "wav" ? bitdepth : undefined,
          stems: allChosen ? undefined : chosen,
        }),
      );
      setFile(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="upload">
      <input
        data-testid="file-input"
        type="file"
        accept=".mp3,.flac,.wav,.ogg,.m4a"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />
      <select value={model} onChange={(e) => setModel(e.target.value)}>
        {models.map((m) => (
          <option key={m.name} value={m.name}>{m.name}</option>
        ))}
      </select>
      <select value={format} onChange={(e) => setFormat(e.target.value as OutputFormat)}>
        <option value="wav">WAV</option>
        <option value="flac">FLAC</option>
        <option value="mp3">MP3</option>
      </select>
      {format === "mp3" && (
        <select value={bitrate} onChange={(e) => setBitrate(Number(e.target.value))}>
          {[128, 192, 256, 320].map((b) => <option key={b} value={b}>{b} kbps</option>)}
        </select>
      )}
      {format === "wav" && (
        <select value={bitdepth} onChange={(e) => setBitdepth(Number(e.target.value))}>
          <option value={16}>16-bit</option>
          <option value={24}>24-bit</option>
          <option value={32}>32-bit float</option>
        </select>
      )}
      <fieldset className="stems">
        {stems.map((s) => (
          <label key={s}>
            <input
              type="checkbox"
              aria-label={s}
              checked={selected[s] ?? true}
              onChange={(e) => setSelected((p) => ({ ...p, [s]: e.target.checked }))}
            />
            {s}
          </label>
        ))}
      </fieldset>
      <button onClick={submit} disabled={!file || busy}>Separate</button>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd webapp/frontend && npm test -- Upload`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add webapp/frontend/src/screens/Upload.tsx webapp/frontend/src/screens/__tests__/Upload.test.tsx
git commit -m "feat(frontend): upload quality options and stem subset selection"
```

**M2 demo:** choose `htdemucs_6s`, FLAC output, deselect piano, separate; force a tiny GPU and confirm the worker logs an OOM fallback without failing the job.

---

## Phase M3 — Studio core (multitrack mixer)

Goal: load a finished job's stems into a synced Web Audio multitrack player with per-stem mute/solo/volume, transport, and waveforms. This delivers vocal **isolation** (solo) and **removal** (mute) interactively.

### Task 20: StudioEngine (Web Audio core, framework-free + unit-tested)

**Files:**
- Create: `webapp/frontend/src/studio/StudioEngine.ts`, `webapp/frontend/src/studio/__tests__/StudioEngine.test.ts`

**Interfaces:**
- Produces: `class StudioEngine` constructed with `(ctx: AudioContext, decode: (url) => Promise<AudioBuffer>)`. Methods: `load(tracks: {stem:string; url:string}[]): Promise<void>`, `play()`, `pause()`, `stop()`, `seek(t:number)`, `setGain(stem, v)`, `setMute(stem, b)`, `setSolo(stem, b)`, `setMasterGain(v)`, getters `duration`, `currentTime`, `isPlaying`, `stems: string[]`. Effective per-stem gain = `0` if muted, or if any solo is active and this stem isn't soloed; else its gain value. Solo/mute changes apply live (set on the live gain node when playing).

- [ ] **Step 1: Write the failing test** — `webapp/frontend/src/studio/__tests__/StudioEngine.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { StudioEngine } from "../StudioEngine";

class FakeGain {
  gain = { value: 1, setValueAtTime: (v: number) => (this.gain.value = v) };
  connect = vi.fn();
}
class FakeSource {
  buffer: any = null;
  onended: any = null;
  connect = vi.fn();
  start = vi.fn();
  stop = vi.fn();
}
class FakeCtx {
  currentTime = 0;
  destination = {};
  createGain = () => new FakeGain();
  createBufferSource = () => new FakeSource();
}

function buffer(dur = 10) {
  return { duration: dur } as unknown as AudioBuffer;
}

describe("StudioEngine", () => {
  let ctx: FakeCtx;
  let engine: StudioEngine;

  beforeEach(async () => {
    ctx = new FakeCtx();
    const decode = vi.fn(async (_url: string) => buffer(10));
    engine = new StudioEngine(ctx as unknown as AudioContext, decode);
    await engine.load([
      { stem: "vocals", url: "/v" },
      { stem: "drums", url: "/d" },
    ]);
  });

  it("loads stems and exposes duration", () => {
    expect(engine.stems).toEqual(["vocals", "drums"]);
    expect(engine.duration).toBe(10);
  });

  it("solo isolates a stem (others muted to 0)", () => {
    engine.setSolo("vocals", true);
    expect(engine.effectiveGain("vocals")).toBe(1);
    expect(engine.effectiveGain("drums")).toBe(0);
  });

  it("mute removes a stem", () => {
    engine.setMute("vocals", true);
    expect(engine.effectiveGain("vocals")).toBe(0);
    expect(engine.effectiveGain("drums")).toBe(1);
  });

  it("gain value is respected when audible", () => {
    engine.setGain("drums", 0.5);
    expect(engine.effectiveGain("drums")).toBe(0.5);
  });

  it("play then pause tracks currentTime from context clock", () => {
    engine.play();
    expect(engine.isPlaying).toBe(true);
    ctx.currentTime = 3;
    expect(engine.currentTime).toBeCloseTo(3, 5);
    engine.pause();
    expect(engine.isPlaying).toBe(false);
    expect(engine.currentTime).toBeCloseTo(3, 5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd webapp/frontend && npm test -- StudioEngine`
Expected: FAIL — cannot resolve `../StudioEngine`.

- [ ] **Step 3: Create `webapp/frontend/src/studio/StudioEngine.ts`**

```typescript
interface Track {
  stem: string;
  buffer: AudioBuffer;
  gainNode: GainNode;
  source: AudioBufferSourceNode | null;
  gain: number;
  muted: boolean;
  solo: boolean;
}

export class StudioEngine {
  private ctx: AudioContext;
  private decode: (url: string) => Promise<AudioBuffer>;
  private master: GainNode;
  private tracks: Track[] = [];
  private playing = false;
  private offset = 0; // seconds into the timeline when paused
  private startedAt = 0; // ctx.currentTime when play() began

  constructor(ctx: AudioContext, decode: (url: string) => Promise<AudioBuffer>) {
    this.ctx = ctx;
    this.decode = decode;
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
  }

  async load(tracks: { stem: string; url: string }[]): Promise<void> {
    this.tracks = [];
    for (const t of tracks) {
      const buffer = await this.decode(t.url);
      const gainNode = this.ctx.createGain();
      gainNode.connect(this.master);
      this.tracks.push({
        stem: t.stem, buffer, gainNode, source: null,
        gain: 1, muted: false, solo: false,
      });
    }
  }

  get stems(): string[] {
    return this.tracks.map((t) => t.stem);
  }

  get duration(): number {
    return this.tracks.reduce((m, t) => Math.max(m, t.buffer.duration), 0);
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  get currentTime(): number {
    return this.playing ? this.ctx.currentTime - this.startedAt : this.offset;
  }

  private anySolo(): boolean {
    return this.tracks.some((t) => t.solo);
  }

  effectiveGain(stem: string): number {
    const t = this.tracks.find((x) => x.stem === stem);
    if (!t) return 0;
    if (t.muted) return 0;
    if (this.anySolo() && !t.solo) return 0;
    return t.gain;
  }

  private applyGains(): void {
    for (const t of this.tracks) {
      t.gainNode.gain.setValueAtTime(this.effectiveGain(t.stem), this.ctx.currentTime);
    }
  }

  setGain(stem: string, v: number): void {
    const t = this.tracks.find((x) => x.stem === stem);
    if (t) {
      t.gain = v;
      this.applyGains();
    }
  }

  setMute(stem: string, b: boolean): void {
    const t = this.tracks.find((x) => x.stem === stem);
    if (t) {
      t.muted = b;
      this.applyGains();
    }
  }

  setSolo(stem: string, b: boolean): void {
    const t = this.tracks.find((x) => x.stem === stem);
    if (t) {
      t.solo = b;
      this.applyGains();
    }
  }

  setMasterGain(v: number): void {
    this.master.gain.setValueAtTime(v, this.ctx.currentTime);
  }

  play(): void {
    if (this.playing) return;
    this.startedAt = this.ctx.currentTime - this.offset;
    for (const t of this.tracks) {
      const src = this.ctx.createBufferSource();
      src.buffer = t.buffer;
      src.connect(t.gainNode);
      src.start(0, this.offset);
      t.source = src;
    }
    this.applyGains();
    this.playing = true;
  }

  pause(): void {
    if (!this.playing) return;
    this.offset = this.currentTime;
    for (const t of this.tracks) {
      t.source?.stop();
      t.source = null;
    }
    this.playing = false;
  }

  stop(): void {
    this.pause();
    this.offset = 0;
  }

  seek(t: number): void {
    const wasPlaying = this.playing;
    if (wasPlaying) this.pause();
    this.offset = Math.max(0, Math.min(t, this.duration));
    if (wasPlaying) this.play();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd webapp/frontend && npm test -- StudioEngine`
Expected: PASS (5 passed).

- [ ] **Step 5: Commit**

```bash
git add webapp/frontend/src/studio/StudioEngine.ts webapp/frontend/src/studio/__tests__/StudioEngine.test.ts
git commit -m "feat(studio): Web Audio multitrack engine (solo/mute/volume/transport)"
```

---

### Task 21: ChannelStrip + Transport components

**Files:**
- Create: `webapp/frontend/src/studio/ChannelStrip.tsx`, `webapp/frontend/src/studio/Transport.tsx`, `webapp/frontend/src/studio/__tests__/Controls.test.tsx`

**Interfaces:**
- Produces: `<ChannelStrip stem label volume muted solo onVolume onMute onSolo />` (vertical fader + S/M buttons). `<Transport playing currentTime duration onPlayPause onStop onSeek />` (play/pause, stop, time readout, seek slider).

- [ ] **Step 1: Write the failing test** — `webapp/frontend/src/studio/__tests__/Controls.test.tsx`

```typescript
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ChannelStrip } from "../ChannelStrip";
import { Transport } from "../Transport";

describe("ChannelStrip", () => {
  it("fires mute/solo/volume callbacks", () => {
    const onMute = vi.fn(), onSolo = vi.fn(), onVolume = vi.fn();
    render(
      <ChannelStrip stem="vocals" label="vocals" volume={1} muted={false} solo={false}
        onMute={onMute} onSolo={onSolo} onVolume={onVolume} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /mute/i }));
    fireEvent.click(screen.getByRole("button", { name: /solo/i }));
    fireEvent.change(screen.getByLabelText(/volume/i), { target: { value: "0.5" } });
    expect(onMute).toHaveBeenCalledWith(true);
    expect(onSolo).toHaveBeenCalledWith(true);
    expect(onVolume).toHaveBeenCalledWith(0.5);
  });
});

describe("Transport", () => {
  it("toggles play and reports seek", () => {
    const onPlayPause = vi.fn(), onSeek = vi.fn();
    render(
      <Transport playing={false} currentTime={5} duration={60}
        onPlayPause={onPlayPause} onStop={vi.fn()} onSeek={onSeek} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /play/i }));
    fireEvent.change(screen.getByLabelText(/seek/i), { target: { value: "12" } });
    expect(onPlayPause).toHaveBeenCalled();
    expect(onSeek).toHaveBeenCalledWith(12);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd webapp/frontend && npm test -- Controls`
Expected: FAIL — cannot resolve components.

- [ ] **Step 3: Create `webapp/frontend/src/studio/ChannelStrip.tsx`**

```typescript
import React from "react";

export interface ChannelStripProps {
  stem: string;
  label: string;
  volume: number;
  muted: boolean;
  solo: boolean;
  onVolume: (v: number) => void;
  onMute: (b: boolean) => void;
  onSolo: (b: boolean) => void;
}

export function ChannelStrip(p: ChannelStripProps) {
  return (
    <div className={`channel-strip ${p.muted ? "is-muted" : ""}`}>
      <div className="channel-label">{p.label}</div>
      <div className="channel-buttons">
        <button aria-pressed={p.solo} aria-label={`solo ${p.label}`} onClick={() => p.onSolo(!p.solo)}>S</button>
        <button aria-pressed={p.muted} aria-label={`mute ${p.label}`} onClick={() => p.onMute(!p.muted)}>M</button>
      </div>
      <input
        type="range" min={0} max={1.5} step={0.01} value={p.volume}
        aria-label={`volume ${p.label}`}
        onChange={(e) => p.onVolume(Number(e.target.value))}
      />
    </div>
  );
}
```

- [ ] **Step 4: Create `webapp/frontend/src/studio/Transport.tsx`**

```typescript
import React from "react";

export interface TransportProps {
  playing: boolean;
  currentTime: number;
  duration: number;
  onPlayPause: () => void;
  onStop: () => void;
  onSeek: (t: number) => void;
}

function fmt(t: number): string {
  const s = Math.floor(t % 60).toString().padStart(2, "0");
  const m = Math.floor(t / 60).toString();
  return `${m}:${s}`;
}

export function Transport(p: TransportProps) {
  return (
    <div className="transport">
      <button aria-label={p.playing ? "pause" : "play"} onClick={p.onPlayPause}>
        {p.playing ? "⏸" : "▶"}
      </button>
      <button aria-label="stop" onClick={p.onStop}>⏹</button>
      <span className="time">{fmt(p.currentTime)} / {fmt(p.duration)}</span>
      <input
        type="range" min={0} max={p.duration || 0} step={0.1} value={p.currentTime}
        aria-label="seek"
        onChange={(e) => p.onSeek(Number(e.target.value))}
      />
    </div>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd webapp/frontend && npm test -- Controls`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add webapp/frontend/src/studio/ChannelStrip.tsx webapp/frontend/src/studio/Transport.tsx webapp/frontend/src/studio/__tests__/Controls.test.tsx
git commit -m "feat(studio): channel strip and transport controls"
```

---

### Task 22: useStudioEngine hook + Waveform + Studio screen + navigation

**Files:**
- Create: `webapp/frontend/src/studio/useStudioEngine.ts`, `webapp/frontend/src/studio/Waveform.tsx`, `webapp/frontend/src/screens/Studio.tsx`, `webapp/frontend/src/studio/__tests__/useStudioEngine.test.ts`
- Modify: `webapp/frontend/src/App.tsx` (add view switching: dashboard ↔ studio)

**Interfaces:**
- Consumes: `StudioEngine`, `stemUrl`, `Job`.
- Produces: `useStudioEngine(job)` returning `{ stems, channels, master, transport, setGain, setMute, setSolo, setMaster, play, pause, stop, seek }` where `transport = { playing, currentTime, duration }` (driven by a `requestAnimationFrame` tick while playing). `<Waveform url />` renders a wavesurfer peaks view (visual only). `<Studio job onBack />` composes channel strips + transport + waveforms. `App` toggles between Dashboard and Studio when a finished job is opened.

- [ ] **Step 1: Write the failing test** — `webapp/frontend/src/studio/__tests__/useStudioEngine.test.ts`

```typescript
import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useStudioEngine } from "../useStudioEngine";
import type { Job } from "../../types";

const job: Job = {
  id: "j1", status: "done", source_filename: "s.wav", model: "htdemucs",
  output_format: "wav", progress: 1, stems: { vocals: "p", drums: "p" },
};

beforeEach(() => {
  // jsdom lacks Web Audio; provide minimal globals
  class FakeGain { gain = { value: 1, setValueAtTime: () => {} }; connect = () => {}; }
  class FakeSrc { buffer: any; onended: any; connect = () => {}; start = () => {}; stop = () => {}; }
  class FakeCtx {
    currentTime = 0; destination = {};
    createGain = () => new FakeGain();
    createBufferSource = () => new FakeSrc();
    decodeAudioData = async () => ({ duration: 10 });
  }
  vi.stubGlobal("AudioContext", FakeCtx as any);
  vi.stubGlobal("fetch", vi.fn(async () => ({ arrayBuffer: async () => new ArrayBuffer(8) })));
});

describe("useStudioEngine", () => {
  it("loads channels and toggles mute", async () => {
    const { result } = renderHook(() => useStudioEngine(job));
    await waitFor(() => expect(result.current.stems).toEqual(["vocals", "drums"]));
    act(() => result.current.setMute("vocals", true));
    expect(result.current.channels.find((c) => c.stem === "vocals")!.muted).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd webapp/frontend && npm test -- useStudioEngine`
Expected: FAIL — cannot resolve `../useStudioEngine`.

- [ ] **Step 3: Create `webapp/frontend/src/studio/useStudioEngine.ts`**

```typescript
import { useEffect, useRef, useState } from "react";
import { StudioEngine } from "./StudioEngine";
import { stemUrl } from "../api/client";
import type { Job } from "../types";

export interface Channel {
  stem: string;
  volume: number;
  muted: boolean;
  solo: boolean;
}

async function decodeFromUrl(ctx: AudioContext, url: string): Promise<AudioBuffer> {
  const res = await fetch(url);
  const buf = await res.arrayBuffer();
  return ctx.decodeAudioData(buf);
}

export function useStudioEngine(job: Job) {
  const engineRef = useRef<StudioEngine | null>(null);
  const [stems, setStems] = useState<string[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [master, setMaster] = useState(1);
  const [transport, setTransport] = useState({ playing: false, currentTime: 0, duration: 0 });

  useEffect(() => {
    const ctx = new AudioContext();
    const engine = new StudioEngine(ctx, (url) => decodeFromUrl(ctx, url));
    engineRef.current = engine;
    const tracks = Object.keys(job.stems ?? {}).map((stem) => ({ stem, url: stemUrl(job.id, stem) }));
    let raf = 0;
    engine.load(tracks).then(() => {
      setStems(engine.stems);
      setChannels(engine.stems.map((stem) => ({ stem, volume: 1, muted: false, solo: false })));
      setTransport((t) => ({ ...t, duration: engine.duration }));
    });
    const tick = () => {
      const e = engineRef.current;
      if (e) setTransport({ playing: e.isPlaying, currentTime: e.currentTime, duration: e.duration });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      engine.stop();
      ctx.close?.();
    };
  }, [job.id]);

  const update = (stem: string, patch: Partial<Channel>) =>
    setChannels((cs) => cs.map((c) => (c.stem === stem ? { ...c, ...patch } : c)));

  return {
    stems,
    channels,
    master,
    transport,
    setGain: (stem: string, v: number) => { engineRef.current?.setGain(stem, v); update(stem, { volume: v }); },
    setMute: (stem: string, b: boolean) => { engineRef.current?.setMute(stem, b); update(stem, { muted: b }); },
    setSolo: (stem: string, b: boolean) => { engineRef.current?.setSolo(stem, b); update(stem, { solo: b }); },
    setMaster: (v: number) => { engineRef.current?.setMasterGain(v); setMaster(v); },
    play: () => engineRef.current?.play(),
    pause: () => engineRef.current?.pause(),
    stop: () => engineRef.current?.stop(),
    seek: (t: number) => engineRef.current?.seek(t),
    engine: engineRef,
  };
}
```

- [ ] **Step 4: Create `webapp/frontend/src/studio/Waveform.tsx`**

```typescript
import React, { useEffect, useRef } from "react";
import WaveSurfer from "wavesurfer.js";

export function Waveform({ url, height = 48 }: { url: string; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const ws = WaveSurfer.create({
      container: ref.current,
      height,
      interact: false,
      waveColor: "#7aa2f7",
      progressColor: "#7aa2f7",
      url,
    });
    return () => ws.destroy();
  }, [url, height]);
  return <div className="waveform" ref={ref} />;
}
```

- [ ] **Step 5: Create `webapp/frontend/src/screens/Studio.tsx`**

```typescript
import React from "react";
import type { Job } from "../types";
import { useStudioEngine } from "../studio/useStudioEngine";
import { ChannelStrip } from "../studio/ChannelStrip";
import { Transport } from "../studio/Transport";
import { Waveform } from "../studio/Waveform";
import { stemUrl } from "../api/client";

export function Studio({ job, onBack }: { job: Job; onBack: () => void }) {
  const s = useStudioEngine(job);
  return (
    <div className="studio">
      <header>
        <button onClick={onBack}>◀ Back</button>
        <strong>{job.source_filename}</strong>
        <span>{job.model} · {job.device_used ?? ""}</span>
      </header>
      <div className="tracks">
        {s.channels.map((c) => (
          <div className="track-row" key={c.stem}>
            <ChannelStrip
              stem={c.stem} label={c.stem} volume={c.volume} muted={c.muted} solo={c.solo}
              onVolume={(v) => s.setGain(c.stem, v)}
              onMute={(b) => s.setMute(c.stem, b)}
              onSolo={(b) => s.setSolo(c.stem, b)}
            />
            <Waveform url={stemUrl(job.id, c.stem)} />
          </div>
        ))}
      </div>
      <Transport
        playing={s.transport.playing}
        currentTime={s.transport.currentTime}
        duration={s.transport.duration}
        onPlayPause={() => (s.transport.playing ? s.pause() : s.play())}
        onStop={s.stop}
        onSeek={s.seek}
      />
      <label className="master">
        Master
        <input type="range" min={0} max={1.5} step={0.01} value={s.master}
          onChange={(e) => s.setMaster(Number(e.target.value))} />
      </label>
    </div>
  );
}
```

- [ ] **Step 6: Update `webapp/frontend/src/App.tsx`** to switch into the studio

```typescript
import React, { useEffect, useState } from "react";
import { Upload } from "./screens/Upload";
import { Dashboard } from "./screens/Dashboard";
import { Studio } from "./screens/Studio";
import { useStore } from "./store";
import { subscribeJob } from "./api/sse";
import { getJob } from "./api/client";
import type { Job } from "./types";

export function App() {
  const jobs = useStore((s) => s.jobs);
  const upsertJob = useStore((s) => s.upsertJob);
  const setProgress = useStore((s) => s.setProgress);
  const [openJob, setOpenJob] = useState<Job | null>(null);

  useEffect(() => {
    const unsubs = jobs
      .filter((j) => j.status === "queued" || j.status === "running")
      .map((j) =>
        subscribeJob(j.id, {
          onProgress: (d) => setProgress(j.id, d.progress, d.stage, d.device),
          onDone: async () => upsertJob(await getJob(j.id)),
          onError: async () => upsertJob(await getJob(j.id)),
        }),
      );
    return () => unsubs.forEach((u) => u());
  }, [jobs.map((j) => `${j.id}:${j.status}`).join(",")]);

  if (openJob) {
    const fresh = jobs.find((j) => j.id === openJob.id) ?? openJob;
    return <Studio job={fresh} onBack={() => setOpenJob(null)} />;
  }

  return (
    <div className="app">
      <h1>Demucs Stem Studio</h1>
      <Upload onCreated={upsertJob} />
      <Dashboard jobs={jobs} onOpen={setOpenJob} />
    </div>
  );
}
```

- [ ] **Step 7: Add an "Open in studio" affordance to Dashboard** — modify `webapp/frontend/src/screens/Dashboard.tsx` signature to `({ jobs, onOpen }: { jobs: Job[]; onOpen?: (j: Job) => void })` and, inside the `done` block, add:

```typescript
{onOpen && <button onClick={() => onOpen(j)}>Open in studio</button>}
```

Update the existing Dashboard test render calls to pass `onOpen={() => {}}` where needed (no assertion change required).

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd webapp/frontend && npm test`
Expected: PASS (all suites).

- [ ] **Step 9: Commit**

```bash
git add webapp/frontend/src/studio webapp/frontend/src/screens/Studio.tsx webapp/frontend/src/screens/Dashboard.tsx webapp/frontend/src/App.tsx
git commit -m "feat(studio): studio screen with synced multitrack mixer and waveforms"
```

**M3 demo:** open a finished job in the studio; play; solo `vocals` (isolation), mute `vocals` (karaoke), drag faders — all in sync.

---

## Phase M4 — Mixdown export & A/B comparison

Goal: export a custom stem combination as a single file (server-side, full resolution) and instantly A/B the current mix against the original track.

### Task 23: Mixdown renderer (numpy/soundfile/lameenc — no torch)

**Files:**
- Create: `webapp/backend/app/core/mix.py`, `webapp/backend/tests/test_mix.py`
- Modify: `webapp/backend/pyproject.toml` (add `numpy`, `lameenc`)

**Interfaces:**
- Produces: `app.core.mix` with `load_audio(path) -> (np.ndarray[frames,ch], sr)`, `mix_tracks(tracks, resolve_path) -> (np.ndarray, sr)` (skips muted/zero-gain, applies gain, length-aligns by padding, clip-safe rescales when peak>1), `write_audio(mix, sr, path, fmt, bitrate=320, bitdepth=16)` (wav via soundfile subtype, flac via soundfile, mp3 via lameenc), `render_mixdown(tracks, resolve_path, out_path, fmt, bitrate=320, bitdepth=16) -> Path`. `tracks` items expose `.stem`, `.gain`, `.muted` (i.e. `MixdownTrack`). **Must not import torch.**

- [ ] **Step 1: Add deps** — in `webapp/backend/pyproject.toml`, extend `dependencies`:

```toml
  "numpy>=1.21",
  "lameenc>=1.4",
```

- [ ] **Step 2: Write the failing test** — `webapp/backend/tests/test_mix.py`

```python
import numpy as np
import soundfile as sf

from app.core import mix
from app.core.schemas import MixdownTrack


def _write(path, value, sr=44100, frames=4410):
    data = np.full((frames, 2), value, dtype="float32")
    sf.write(str(path), data, sr, subtype="FLOAT")


def test_mix_skips_muted(tmp_path):
    _write(tmp_path / "vocals.wav", 0.4)
    _write(tmp_path / "drums.wav", 0.1)
    resolve = lambda stem: tmp_path / f"{stem}.wav"
    tracks = [
        MixdownTrack(stem="vocals", gain=1.0, muted=True),
        MixdownTrack(stem="drums", gain=1.0, muted=False),
    ]
    out, sr = mix.mix_tracks(tracks, resolve)
    assert sr == 44100
    assert np.allclose(out, 0.1, atol=1e-4)  # only drums survived


def test_mix_sums_and_rescales(tmp_path):
    _write(tmp_path / "a.wav", 0.8)
    _write(tmp_path / "b.wav", 0.8)
    resolve = lambda stem: tmp_path / f"{stem}.wav"
    tracks = [MixdownTrack(stem="a"), MixdownTrack(stem="b")]
    out, _ = mix.mix_tracks(tracks, resolve)
    assert float(np.max(np.abs(out))) <= 1.0 + 1e-6  # 1.6 peak rescaled


def test_render_writes_flac(tmp_path):
    _write(tmp_path / "a.wav", 0.2)
    resolve = lambda stem: tmp_path / f"{stem}.wav"
    out = mix.render_mixdown([MixdownTrack(stem="a")], resolve, tmp_path / "mix.flac", "flac")
    data, sr = sf.read(str(out))
    assert sr == 44100 and data.shape[0] == 4410
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd webapp/backend && python -m pytest tests/test_mix.py -v`
Expected: FAIL — cannot import `app.core.mix`.

- [ ] **Step 4: Create `webapp/backend/app/core/mix.py`**

```python
from __future__ import annotations

from pathlib import Path
from typing import Callable, List, Tuple

import numpy as np
import soundfile as sf

from app.core import paths


def load_audio(path) -> Tuple[np.ndarray, int]:
    data, sr = sf.read(str(path), always_2d=True, dtype="float32")  # frames x channels
    return data, sr


def _pad(a: np.ndarray, n: int) -> np.ndarray:
    if a.shape[0] >= n:
        return a[:n]
    return np.pad(a, ((0, n - a.shape[0]), (0, 0)))


def mix_tracks(tracks: List, resolve_path: Callable) -> Tuple[np.ndarray, int]:
    mix: np.ndarray | None = None
    sr = None
    channels = 2
    for t in tracks:
        if t.muted or t.gain == 0:
            continue
        data, s = load_audio(resolve_path(t.stem))
        sr = sr or s
        channels = data.shape[1]
        data = data * float(t.gain)
        if mix is None:
            mix = data
        else:
            n = max(mix.shape[0], data.shape[0])
            mix = _pad(mix, n) + _pad(data, n)
    if mix is None:
        sr = sr or 44100
        mix = np.zeros((1, channels), dtype="float32")
    peak = float(np.max(np.abs(mix))) if mix.size else 0.0
    if peak > 1.0:
        mix = mix / peak
    return mix.astype("float32"), sr


def write_audio(mix: np.ndarray, sr: int, path, fmt: str,
                bitrate: int = 320, bitdepth: int = 16) -> None:
    path = Path(path)
    paths.ensure_parent(path)
    if fmt == "wav":
        subtype = {16: "PCM_16", 24: "PCM_24", 32: "FLOAT"}.get(bitdepth, "PCM_16")
        sf.write(str(path), mix, sr, subtype=subtype)
    elif fmt == "flac":
        sf.write(str(path), mix, sr, format="FLAC")
    elif fmt == "mp3":
        import lameenc

        ints = np.clip(mix, -1.0, 1.0)
        ints = (ints * 32767).astype("<i2")
        enc = lameenc.Encoder()
        enc.set_bit_rate(bitrate)
        enc.set_in_sample_rate(sr)
        enc.set_channels(mix.shape[1])
        enc.set_quality(2)
        data = enc.encode(ints.tobytes()) + enc.flush()
        path.write_bytes(data)
    else:
        raise ValueError(f"Unsupported format: {fmt}")


def render_mixdown(tracks: List, resolve_path: Callable, out_path, fmt: str,
                   bitrate: int = 320, bitdepth: int = 16) -> Path:
    mix, sr = mix_tracks(tracks, resolve_path)
    write_audio(mix, sr, out_path, fmt, bitrate, bitdepth)
    return Path(out_path)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd webapp/backend && python -m pytest tests/test_mix.py -v`
Expected: PASS (3 passed).

- [ ] **Step 6: Commit**

```bash
git add webapp/backend/app/core/mix.py webapp/backend/tests/test_mix.py webapp/backend/pyproject.toml
git commit -m "feat(backend): server-side mixdown renderer (numpy, no torch)"
```

---

### Task 24: Mixdown + source routes and persistence

**Files:**
- Create: `webapp/backend/app/api/routes_mixdown.py`, `webapp/backend/tests/test_api_mixdown.py`
- Modify: `webapp/backend/app/core/jobs.py` (add `create_mixdown`, `get_mixdown`)
- Modify: `webapp/backend/app/api/routes_stems.py` (add `GET /jobs/{id}/source`)
- Modify: `webapp/backend/app/main.py` (include mixdown router)

**Interfaces:**
- Consumes: `mix.render_mixdown`, `jobs`, `paths`, `MixdownRequest`/`MixdownOut`.
- Produces: `jobs.create_mixdown(conn, *, job_id, name, spec_json, path, fmt) -> MixdownOut`, `jobs.get_mixdown(conn, mid) -> dict | None`; routes `POST /api/jobs/{id}/mixdown` → `MixdownOut`, `GET /api/mixdowns/{mid}/download` → `FileResponse`, `GET /api/jobs/{id}/source` → `FileResponse` (the uploaded original, for A/B).

- [ ] **Step 1: Add to `webapp/backend/app/core/jobs.py`**

```python
def create_mixdown(conn, *, job_id, name, spec_json, path, fmt):
    from app.core.schemas import MixdownOut

    mid = uuid.uuid4().hex
    now = _now()
    conn.execute(
        "INSERT INTO mixdowns (id,job_id,name,spec,path,format,created_at) VALUES (?,?,?,?,?,?,?)",
        (mid, job_id, name, spec_json, str(path), fmt, now),
    )
    conn.commit()
    return MixdownOut(id=mid, job_id=job_id, name=name, format=fmt, created_at=now)


def get_mixdown(conn, mid):
    row = conn.execute("SELECT * FROM mixdowns WHERE id=?", (mid,)).fetchone()
    return dict(row) if row else None
```

- [ ] **Step 2: Write the failing test** — `webapp/backend/tests/test_api_mixdown.py`

```python
import numpy as np
import soundfile as sf
from fastapi.testclient import TestClient

from app.core import jobs, paths
from app.core.db import get_connection, init_db
from app.core.schemas import JobCreate
from app.main import create_app


def _finished_job(settings):
    init_db()
    conn = get_connection()
    job = jobs.create_job(
        conn, source_filename="s.wav", source_path="/tmp/s.wav",
        source_format="wav", source_duration=1.0, source_bytes=1, spec=JobCreate(),
    )
    stems = {}
    for name, val in (("vocals", 0.5), ("drums", 0.2)):
        p = paths.ensure_parent(paths.stem_path(job.id, name, "wav"))
        sf.write(str(p), np.full((4410, 2), val, dtype="float32"), 44100, subtype="FLOAT")
        stems[name] = str(p.relative_to(settings.data_dir))
    jobs.finish_job(conn, job.id, stems)
    conn.close()
    return job


def test_create_and_download_mixdown(settings):
    job = _finished_job(settings)
    client = TestClient(create_app())
    r = client.post(
        f"/api/jobs/{job.id}/mixdown",
        json={"name": "instrumental", "format": "wav",
              "tracks": [{"stem": "vocals", "gain": 1.0, "muted": True},
                         {"stem": "drums", "gain": 1.0, "muted": False}]},
    )
    assert r.status_code == 200, r.text
    mid = r.json()["id"]
    dl = client.get(f"/api/mixdowns/{mid}/download")
    assert dl.status_code == 200 and len(dl.content) > 0
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd webapp/backend && python -m pytest tests/test_api_mixdown.py -v`
Expected: FAIL — cannot import `app.api.routes_mixdown`.

- [ ] **Step 4: Create `webapp/backend/app/api/routes_mixdown.py`**

```python
from __future__ import annotations

import json
import uuid

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from app.config import get_settings
from app.core import jobs, mix, paths
from app.core.db import get_connection
from app.core.schemas import MixdownOut, MixdownRequest

router = APIRouter(prefix="/api")


@router.post("/jobs/{jid}/mixdown", response_model=MixdownOut)
def create_mixdown_route(jid: str, req: MixdownRequest):
    conn = get_connection()
    try:
        job = jobs.get_job(conn, jid)
        if not job or job.status != "done" or not job.stems:
            raise HTTPException(404, "Finished job with stems not found")
        data_dir = get_settings().data_dir

        def resolve(stem):
            if stem not in job.stems:
                raise HTTPException(400, f"Unknown stem: {stem}")
            return data_dir / job.stems[stem]

        mid = uuid.uuid4().hex
        out = paths.mixdown_path(jid, mid, req.format)
        mix.render_mixdown([t for t in req.tracks], resolve, out, req.format,
                           bitrate=req.bitrate or 320, bitdepth=req.bitdepth or 16)
        return jobs.create_mixdown(
            conn, job_id=jid, name=req.name,
            spec_json=json.dumps(req.model_dump()), path=out, fmt=req.format,
        )
    finally:
        conn.close()


@router.get("/mixdowns/{mid}/download")
def download_mixdown(mid: str):
    conn = get_connection()
    try:
        row = jobs.get_mixdown(conn, mid)
    finally:
        conn.close()
    if not row:
        raise HTTPException(404, "Mixdown not found")
    from pathlib import Path

    p = Path(row["path"])
    if not p.exists():
        raise HTTPException(404, "Mixdown file missing")
    return FileResponse(str(p), filename=f"{row['name']}.{row['format']}")
```

- [ ] **Step 5: Add the source route** — append to `webapp/backend/app/api/routes_stems.py`

```python
@router.get("/jobs/{jid}/source")
def get_source(jid: str):
    conn = get_connection()
    try:
        job = jobs.get_job(conn, jid)
    finally:
        conn.close()
    if not job or not job.source_path:
        raise HTTPException(404, "Source not found")
    from pathlib import Path

    p = Path(job.source_path)
    if not p.exists():
        raise HTTPException(404, "Source file missing")
    return FileResponse(str(p), filename=p.name)
```

- [ ] **Step 6: Wire the mixdown router** — modify `webapp/backend/app/main.py` router block:

```python
    from app.api import routes_meta, routes_jobs, routes_stems, routes_mixdown, sse
    app.include_router(routes_meta.router)
    app.include_router(routes_jobs.router)
    app.include_router(routes_stems.router)
    app.include_router(routes_mixdown.router)
    app.include_router(sse.router)
    return app
```

- [ ] **Step 7: Run test to verify it passes**

Run: `cd webapp/backend && python -m pytest tests/test_api_mixdown.py -v`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add webapp/backend/app/api/routes_mixdown.py webapp/backend/app/core/jobs.py webapp/backend/app/api/routes_stems.py webapp/backend/app/main.py webapp/backend/tests/test_api_mixdown.py
git commit -m "feat(backend): mixdown render/download and source routes"
```

---

### Task 25: A/B comparison + Export panel (frontend)

**Files:**
- Modify: `webapp/frontend/src/studio/StudioEngine.ts` (A/B mode + original track)
- Modify: `webapp/frontend/src/api/client.ts` (add `createMixdown`, `mixdownDownloadUrl`, `sourceUrl`)
- Create: `webapp/frontend/src/studio/ABToggle.tsx`, `webapp/frontend/src/studio/ExportPanel.tsx`
- Create: `webapp/frontend/src/studio/__tests__/ab_export.test.tsx`
- Modify: `webapp/frontend/src/studio/StudioEngine.ts` test expectations are unaffected (default mode = "mix")
- Modify: `webapp/frontend/src/screens/Studio.tsx` (wire A/B + export)
- Modify: `webapp/frontend/src/studio/useStudioEngine.ts` (expose `abMode`, `setABMode`, load original)

**Interfaces:**
- Produces: client `createMixdown(jobId, req: MixdownRequest) -> MixdownOut`, `mixdownDownloadUrl(mid)`, `sourceUrl(jobId)`. StudioEngine gains `setABMode("original"|"mix")` and `loadOriginal(url)`; when mode is `"original"`, only the original track is audible. `<ABToggle mode onMode />`. `<ExportPanel onExport(format, name) />` builds a `MixdownRequest` from current channel state and triggers download.

- [ ] **Step 1: Write the failing test** — `webapp/frontend/src/studio/__tests__/ab_export.test.tsx`

```typescript
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ABToggle } from "../ABToggle";
import { ExportPanel } from "../ExportPanel";

describe("ABToggle", () => {
  it("reports mode changes", () => {
    const onMode = vi.fn();
    render(<ABToggle mode="mix" onMode={onMode} />);
    fireEvent.click(screen.getByRole("button", { name: /original/i }));
    expect(onMode).toHaveBeenCalledWith("original");
  });
});

describe("ExportPanel", () => {
  it("invokes export with chosen format and name", () => {
    const onExport = vi.fn();
    render(<ExportPanel onExport={onExport} />);
    fireEvent.change(screen.getByLabelText(/format/i), { target: { value: "flac" } });
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "karaoke" } });
    fireEvent.click(screen.getByRole("button", { name: /export/i }));
    expect(onExport).toHaveBeenCalledWith("flac", "karaoke");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd webapp/frontend && npm test -- ab_export`
Expected: FAIL — cannot resolve components.

- [ ] **Step 3: Extend `webapp/frontend/src/studio/StudioEngine.ts`** — add A/B support.

Add fields/methods to the class (alongside existing ones):

```typescript
  // add to class fields:
  private abMode: "original" | "mix" = "mix";
  private original: Track | null = null;

  async loadOriginal(url: string): Promise<void> {
    const buffer = await this.decode(url);
    const gainNode = this.ctx.createGain();
    gainNode.connect(this.master);
    this.original = {
      stem: "__original__", buffer, gainNode, source: null,
      gain: 1, muted: false, solo: false,
    };
  }

  setABMode(mode: "original" | "mix"): void {
    this.abMode = mode;
    this.applyGains();
  }
```

Then update `effectiveGain` to account for A/B (replace the method body):

```typescript
  effectiveGain(stem: string): number {
    if (this.abMode === "original") return stem === "__original__" ? 1 : 0;
    if (stem === "__original__") return 0;
    const t = this.tracks.find((x) => x.stem === stem);
    if (!t) return 0;
    if (t.muted) return 0;
    if (this.anySolo() && !t.solo) return 0;
    return t.gain;
  }
```

And include the original track in `applyGains`, `play`, and `pause` loops by iterating `[...this.tracks, ...(this.original ? [this.original] : [])]` in each of those three methods (replace `this.tracks` with a `this.allTracks()` helper):

```typescript
  private allTracks(): Track[] {
    return this.original ? [...this.tracks, this.original] : [...this.tracks];
  }
```
Use `this.allTracks()` in `applyGains()`, `play()`, and `pause()` where they currently iterate `this.tracks`. (`stems`, `effectiveGain`, set* still operate on `this.tracks` only, so channel strips never show the original.)

- [ ] **Step 4: Extend `webapp/frontend/src/api/client.ts`**

```typescript
import type { CreateJobOpts, Job, ModelInfo, MixdownRequest } from "../types";
// ... existing code ...

export interface MixdownOut {
  id: string;
  job_id: string;
  name: string;
  format: string;
  created_at: string;
}

export async function createMixdown(jobId: string, req: MixdownRequest): Promise<MixdownOut> {
  return json(
    await fetch(`${BASE}/jobs/${jobId}/mixdown`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    }),
  );
}

export function mixdownDownloadUrl(mid: string): string {
  return `${BASE}/mixdowns/${mid}/download`;
}

export function sourceUrl(jobId: string): string {
  return `${BASE}/jobs/${jobId}/source`;
}
```

- [ ] **Step 5: Create `webapp/frontend/src/studio/ABToggle.tsx`**

```typescript
import React from "react";

export function ABToggle({ mode, onMode }: { mode: "original" | "mix"; onMode: (m: "original" | "mix") => void }) {
  return (
    <div className="ab-toggle" role="group" aria-label="A/B comparison">
      <button aria-pressed={mode === "original"} onClick={() => onMode("original")}>Original</button>
      <button aria-pressed={mode === "mix"} onClick={() => onMode("mix")}>Mix</button>
    </div>
  );
}
```

- [ ] **Step 6: Create `webapp/frontend/src/studio/ExportPanel.tsx`**

```typescript
import React, { useState } from "react";
import type { OutputFormat } from "../types";

export function ExportPanel({ onExport }: { onExport: (format: OutputFormat, name: string) => void }) {
  const [format, setFormat] = useState<OutputFormat>("mp3");
  const [name, setName] = useState("mixdown");
  return (
    <div className="export-panel">
      <label>
        Name
        <input aria-label="name" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        Format
        <select aria-label="format" value={format} onChange={(e) => setFormat(e.target.value as OutputFormat)}>
          <option value="mp3">MP3</option>
          <option value="flac">FLAC</option>
          <option value="wav">WAV</option>
        </select>
      </label>
      <button onClick={() => onExport(format, name)}>Export mixdown</button>
    </div>
  );
}
```

- [ ] **Step 7: Extend `webapp/frontend/src/studio/useStudioEngine.ts`** — add A/B + original loading + export helper. Inside the hook, after `engine.load(tracks)...`, also load the original and add state:

```typescript
  const [abMode, setAbModeState] = useState<"original" | "mix">("mix");
```
In the load effect, after `engine.load(tracks).then(...)`, chain:
```typescript
    engine.loadOriginal(sourceUrl(job.id)).catch(() => {});
```
(import `sourceUrl` from `../api/client`). Add to the returned object:
```typescript
    abMode,
    setABMode: (m: "original" | "mix") => { engineRef.current?.setABMode(m); setAbModeState(m); },
    buildMixdownRequest: (format: "wav" | "flac" | "mp3", name: string) => ({
      name, format,
      bitrate: format === "mp3" ? 320 : undefined,
      bitdepth: format === "wav" ? 16 : undefined,
      tracks: channels.map((c) => ({ stem: c.stem, gain: c.volume, muted: c.muted })),
    }),
```

- [ ] **Step 8: Wire into `webapp/frontend/src/screens/Studio.tsx`** — add imports and, in the header area and footer, render the toggle + export:

```typescript
import { ABToggle } from "../studio/ABToggle";
import { ExportPanel } from "../studio/ExportPanel";
import { createMixdown, mixdownDownloadUrl } from "../api/client";
// ... inside component, after const s = useStudioEngine(job):
async function handleExport(format: "wav" | "flac" | "mp3", name: string) {
  const req = s.buildMixdownRequest(format, name);
  const out = await createMixdown(job.id, req);
  window.location.href = mixdownDownloadUrl(out.id);
}
// ... in JSX header: <ABToggle mode={s.abMode} onMode={s.setABMode} />
// ... near the transport/footer: <ExportPanel onExport={handleExport} />
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `cd webapp/frontend && npm test`
Expected: PASS (all suites, including unchanged StudioEngine tests).

- [ ] **Step 10: Commit**

```bash
git add webapp/frontend/src/studio webapp/frontend/src/api/client.ts webapp/frontend/src/screens/Studio.tsx
git commit -m "feat(studio): A/B comparison against original and server-side mixdown export"
```

**M4 demo:** in the studio, mute vocals → Export mixdown as MP3 → an instrumental downloads. Toggle Original/Mix to compare your karaoke mix against the source.

---

## Phase M5 — Library & batch processing

Goal: persistent job-history library (reopen / re-download / delete / search) and multi-file batch upload that queues sequentially.

### Task 26: Library screen + history loading

**Files:**
- Create: `webapp/frontend/src/screens/Library.tsx`, `webapp/frontend/src/screens/__tests__/Library.test.tsx`
- Modify: `webapp/frontend/src/App.tsx` (load history on mount; add Dashboard/Library nav)

**Interfaces:**
- Consumes: `client.listJobs`, `client.deleteJob`, `Job`.
- Produces: `<Library jobs onOpen onDelete />` — text filter over `source_filename`, each row shows filename + status + model, an "Open" button (only when `done`) and a "Delete" button. App fetches `listJobs()` once on mount to populate the store with history.

- [ ] **Step 1: Write the failing test** — `webapp/frontend/src/screens/__tests__/Library.test.tsx`

```typescript
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { Library } from "../Library";
import type { Job } from "../../types";

const jobs: Job[] = [
  { id: "1", status: "done", source_filename: "Song A.mp3", model: "htdemucs", output_format: "wav", progress: 1, stems: { vocals: "p" } },
  { id: "2", status: "done", source_filename: "Track B.flac", model: "htdemucs_6s", output_format: "flac", progress: 1, stems: { vocals: "p" } },
];

describe("Library", () => {
  it("filters by filename", () => {
    render(<Library jobs={jobs} onOpen={vi.fn()} onDelete={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "track" } });
    expect(screen.queryByText("Song A.mp3")).toBeNull();
    expect(screen.getByText("Track B.flac")).toBeTruthy();
  });

  it("fires open and delete", () => {
    const onOpen = vi.fn(), onDelete = vi.fn();
    render(<Library jobs={jobs} onOpen={onOpen} onDelete={onDelete} />);
    fireEvent.click(screen.getAllByRole("button", { name: /open/i })[0]);
    fireEvent.click(screen.getAllByRole("button", { name: /delete/i })[0]);
    expect(onOpen).toHaveBeenCalledWith(jobs[0]);
    expect(onDelete).toHaveBeenCalledWith("1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd webapp/frontend && npm test -- Library`
Expected: FAIL — cannot resolve `../Library`.

- [ ] **Step 3: Create `webapp/frontend/src/screens/Library.tsx`**

```typescript
import React, { useMemo, useState } from "react";
import type { Job } from "../types";

export function Library({
  jobs, onOpen, onDelete,
}: {
  jobs: Job[];
  onOpen: (j: Job) => void;
  onDelete: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const filtered = useMemo(
    () => jobs.filter((j) => j.source_filename.toLowerCase().includes(q.toLowerCase())),
    [jobs, q],
  );
  return (
    <div className="library">
      <input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
      <ul>
        {filtered.map((j) => (
          <li key={j.id}>
            <span className="name">{j.source_filename}</span>
            <span className="meta">{j.model} · {j.status}</span>
            {j.status === "done" && <button onClick={() => onOpen(j)}>Open</button>}
            <button onClick={() => onDelete(j.id)}>Delete</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: Update `webapp/frontend/src/App.tsx`** — load history + add nav. Add near the top of the component:

```typescript
import { Library } from "./screens/Library";
import { listJobs, deleteJob } from "./api/client";
// ... inside App, add state and effects:
const [view, setView] = useState<"home" | "library">("home");

useEffect(() => {
  listJobs().then((all) => all.forEach(upsertJob)).catch(() => {});
}, []);

async function handleDelete(id: string) {
  await deleteJob(id);
  useStore.setState((s) => ({ jobs: s.jobs.filter((j) => j.id !== id) }));
}
```

Add nav buttons and conditional rendering in the returned JSX (when not in studio):

```typescript
<nav>
  <button onClick={() => setView("home")}>Home</button>
  <button onClick={() => setView("library")}>Library</button>
</nav>
{view === "library"
  ? <Library jobs={jobs} onOpen={setOpenJob} onDelete={handleDelete} />
  : (<><Upload onCreated={upsertJob} /><Dashboard jobs={jobs} onOpen={setOpenJob} /></>)}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd webapp/frontend && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add webapp/frontend/src/screens/Library.tsx webapp/frontend/src/screens/__tests__/Library.test.tsx webapp/frontend/src/App.tsx
git commit -m "feat(frontend): job-history library with search, open, delete"
```

---

### Task 27: Batch upload

**Files:**
- Modify: `webapp/frontend/src/screens/Upload.tsx` (accept multiple files, shared `batch_id`)
- Modify: `webapp/frontend/src/screens/__tests__/Upload.test.tsx`
- Modify: `webapp/frontend/src/screens/Dashboard.tsx` (group by `batch_id`)

**Interfaces:**
- Produces: Upload accepts `multiple`; on submit with N>1 files it generates one `batch_id` (`crypto.randomUUID()`) and calls `createJob` once per file with that `batch_id`, invoking `onCreated` for each. Dashboard renders a "Batch (N)" header grouping cards that share a `batch_id`.

- [ ] **Step 1: Extend the failing test** — add to `webapp/frontend/src/screens/__tests__/Upload.test.tsx`

```typescript
it("creates one job per file sharing a batch_id", async () => {
  vi.spyOn(client, "listModels").mockResolvedValue([
    { name: "htdemucs", stems: ["drums", "bass", "other", "vocals"], description: "" },
  ]);
  const create = vi.spyOn(client, "createJob").mockImplementation(async (f) => ({
    id: f.name, status: "queued", source_filename: f.name,
    model: "htdemucs", output_format: "wav", progress: 0,
  }));
  render(<Upload onCreated={vi.fn()} />);
  await screen.findByLabelText("vocals");
  const f1 = new File([new Uint8Array([1])], "a.mp3");
  const f2 = new File([new Uint8Array([2])], "b.mp3");
  fireEvent.change(screen.getByTestId("file-input"), { target: { files: [f1, f2] } });
  fireEvent.click(screen.getByText(/separate/i));
  await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
  const batchA = create.mock.calls[0][1].batch_id;
  const batchB = create.mock.calls[1][1].batch_id;
  expect(batchA).toBeTruthy();
  expect(batchA).toBe(batchB);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd webapp/frontend && npm test -- Upload`
Expected: FAIL — only one job created / no batch_id.

- [ ] **Step 3: Update `webapp/frontend/src/screens/Upload.tsx`** — support multiple files. Change the file state to a list and the input to `multiple`, and rewrite `submit`:

```typescript
  const [files, setFiles] = useState<File[]>([]);
  // input:
  // <input data-testid="file-input" type="file" multiple
  //   accept=".mp3,.flac,.wav,.ogg,.m4a"
  //   onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
  // button disabled={files.length === 0 || busy}

  async function submit() {
    if (files.length === 0) return;
    setBusy(true);
    try {
      const chosen = stems.filter((s) => selected[s]);
      const allChosen = chosen.length === stems.length;
      const batch_id = files.length > 1 ? crypto.randomUUID() : undefined;
      for (const f of files) {
        onCreated(
          await createJob(f, {
            model,
            output_format: format,
            output_bitrate: format === "mp3" ? bitrate : undefined,
            output_bitdepth: format === "wav" ? bitdepth : undefined,
            stems: allChosen ? undefined : chosen,
            batch_id,
          }),
        );
      }
      setFiles([]);
    } finally {
      setBusy(false);
    }
  }
```

(Replace the previous single-`file` state, input handler, and submit body accordingly; keep the rest of the component intact.)

- [ ] **Step 4: Group batches in `webapp/frontend/src/screens/Dashboard.tsx`** — before rendering, partition jobs:

```typescript
// helper inside the module:
function groupByBatch(jobs: Job[]): { batch?: string; jobs: Job[] }[] {
  const groups = new Map<string, Job[]>();
  const singles: Job[] = [];
  for (const j of jobs) {
    if (j.batch_id) groups.set(j.batch_id, [...(groups.get(j.batch_id) ?? []), j]);
    else singles.push(j);
  }
  return [
    ...[...groups.entries()].map(([batch, jobs]) => ({ batch, jobs })),
    ...singles.map((j) => ({ jobs: [j] })),
  ];
}
```
Wrap the existing card-rendering loop so each group with a `batch` first renders `<div className="batch-head">Batch ({group.jobs.length})</div>`, then its cards. (The existing per-job card markup and `data-testid` stay unchanged so prior tests keep passing.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd webapp/frontend && npm test`
Expected: PASS (all suites).

- [ ] **Step 6: Commit**

```bash
git add webapp/frontend/src/screens/Upload.tsx webapp/frontend/src/screens/__tests__/Upload.test.tsx webapp/frontend/src/screens/Dashboard.tsx
git commit -m "feat(frontend): batch upload with shared batch_id and grouped dashboard"
```

**M5 demo:** drop three songs at once → they queue and process one after another; finished tracks appear in the Library, searchable and re-openable; delete one and its files are gone.

---

## Phase M6 — Polish & packaging

Goal: one-command launch that serves the built SPA from FastAPI, a setup health banner, docs, and a hardened test pass.

### Task 28: Serve built SPA + health banner

**Files:**
- Modify: `webapp/backend/app/config.py` (add `frontend_dist: Optional[Path]`)
- Modify: `webapp/backend/app/main.py` (mount StaticFiles SPA when present)
- Create: `webapp/backend/tests/test_spa.py`
- Create: `webapp/frontend/src/components/HealthBanner.tsx`, `webapp/frontend/src/components/__tests__/HealthBanner.test.tsx`
- Modify: `webapp/frontend/src/App.tsx` (render `<HealthBanner />`)

**Interfaces:**
- Produces: `Settings.frontend_dist` (env `STUDIO_FRONTEND_DIST`); when that dir (or the default `webapp/frontend/dist`) exists, the app mounts it at `/` with SPA fallback (`html=True`), AFTER the API routers so `/api/*` wins. `<HealthBanner />` polls `client.health()` once and shows a warning bar when `ffmpeg` is missing or `worker_alive` is false; renders nothing when healthy.

- [ ] **Step 1: Add the setting** — in `webapp/backend/app/config.py`, add an import and field:

```python
from typing import Optional
# ... in Settings:
    frontend_dist: Optional[Path] = None
```

- [ ] **Step 2: Write the failing backend test** — `webapp/backend/tests/test_spa.py`

```python
from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import create_app


def test_spa_served_when_dist_present(tmp_path, monkeypatch):
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("<!doctype html><title>studio</title>")
    monkeypatch.setenv("STUDIO_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("STUDIO_FRONTEND_DIST", str(dist))
    get_settings.cache_clear()
    client = TestClient(create_app())
    assert client.get("/api/models").status_code == 200  # API still wins
    r = client.get("/")
    assert r.status_code == 200 and "studio" in r.text
    get_settings.cache_clear()
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd webapp/backend && python -m pytest tests/test_spa.py -v`
Expected: FAIL — `/` returns 404 (no SPA mounted).

- [ ] **Step 4: Mount the SPA** — in `webapp/backend/app/main.py`, after the router includes and before `return app`:

```python
    from pathlib import Path
    from fastapi.staticfiles import StaticFiles
    from app.config import get_settings

    settings = get_settings()
    dist = settings.frontend_dist or (Path(__file__).resolve().parents[2] / "frontend" / "dist")
    if Path(dist).exists():
        app.mount("/", StaticFiles(directory=str(dist), html=True), name="spa")
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd webapp/backend && python -m pytest tests/test_spa.py -v`
Expected: PASS.

- [ ] **Step 6: Write the failing frontend test** — `webapp/frontend/src/components/__tests__/HealthBanner.test.tsx`

```typescript
import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { HealthBanner } from "../HealthBanner";
import * as client from "../../api/client";

describe("HealthBanner", () => {
  it("warns when ffmpeg missing", async () => {
    vi.spyOn(client, "health").mockResolvedValue({ db: true, ffmpeg: false, worker_alive: true });
    render(<HealthBanner />);
    await waitFor(() => expect(screen.getByText(/ffmpeg/i)).toBeTruthy());
  });

  it("renders nothing when healthy", async () => {
    vi.spyOn(client, "health").mockResolvedValue({ db: true, ffmpeg: true, worker_alive: true });
    const { container } = render(<HealthBanner />);
    await waitFor(() => expect(container.textContent).toBe(""));
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `cd webapp/frontend && npm test -- HealthBanner`
Expected: FAIL — cannot resolve `../HealthBanner`.

- [ ] **Step 8: Create `webapp/frontend/src/components/HealthBanner.tsx`**

```typescript
import React, { useEffect, useState } from "react";
import { health } from "../api/client";

export function HealthBanner() {
  const [warnings, setWarnings] = useState<string[]>([]);
  useEffect(() => {
    health()
      .then((h) => {
        const w: string[] = [];
        if (!h.ffmpeg) w.push("ffmpeg not found on PATH — audio decoding will fail. Install ffmpeg.");
        if (!h.worker_alive) w.push("Worker is offline — start it with `python -m app.worker`.");
        setWarnings(w);
      })
      .catch(() => setWarnings(["Cannot reach the backend API."]));
  }, []);
  if (warnings.length === 0) return null;
  return (
    <div className="health-banner" role="alert">
      {warnings.map((w) => <div key={w}>⚠ {w}</div>)}
    </div>
  );
}
```

- [ ] **Step 9: Render it** — in `webapp/frontend/src/App.tsx`, import and place `<HealthBanner />` just under the `<h1>`. (No assertion-affecting change to other tests.)

- [ ] **Step 10: Run tests to verify they pass**

Run: `cd webapp/backend && python -m pytest tests/test_spa.py -v` and `cd webapp/frontend && npm test -- HealthBanner`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add webapp/backend/app/config.py webapp/backend/app/main.py webapp/backend/tests/test_spa.py webapp/frontend/src/components webapp/frontend/src/App.tsx
git commit -m "feat: serve built SPA from FastAPI and add setup health banner"
```

---

### Task 29: Docs, production launch, and full-suite verification

**Files:**
- Create: `webapp/README.md`, `webapp/backend/.env.example`, `webapp/scripts/run-prod.ps1`, `webapp/scripts/run-prod.sh`

**Interfaces:**
- Produces: setup/run documentation, a sample env file, and a prod launcher that builds the frontend and runs API (serving static) + worker together.

- [ ] **Step 1: Create `webapp/backend/.env.example`**

```
# Copy to webapp/backend/.env and adjust as needed.
STUDIO_DATA_DIR=data
STUDIO_MAX_UPLOAD_BYTES=209715200
STUDIO_DEFAULT_MODEL=htdemucs
STUDIO_DEFAULT_OUTPUT_FORMAT=wav
STUDIO_PORT=8000
STUDIO_MAX_ATTEMPTS=1
STUDIO_MODEL_CACHE_SIZE=2
```

- [ ] **Step 2: Create `webapp/scripts/run-prod.ps1`**

```powershell
# Build the SPA, then run API (serving static) + worker (Windows).
$root = Split-Path $PSScriptRoot -Parent
Push-Location "$root/frontend"; npm install; npm run build; Pop-Location
Start-Process powershell -ArgumentList "-NoExit","-Command","cd '$root/backend'; python -m app.worker"
Push-Location "$root/backend"; uvicorn app.main:app --host 127.0.0.1 --port 8000; Pop-Location
```

- [ ] **Step 3: Create `webapp/scripts/run-prod.sh`**

```bash
#!/usr/bin/env bash
set -e
root="$(cd "$(dirname "$0")/.." && pwd)"
( cd "$root/frontend" && npm install && npm run build )
( cd "$root/backend" && python -m app.worker ) &
( cd "$root/backend" && uvicorn app.main:app --host 127.0.0.1 --port 8000 )
```

- [ ] **Step 4: Create `webapp/README.md`**

````markdown
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
````

- [ ] **Step 5: Full-suite verification**

Run (backend): `cd webapp/backend && python -m pytest -m "not integration" -v`
Expected: all unit/API suites PASS.
Run (frontend): `cd webapp/frontend && npm test`
Expected: all suites PASS.
Run (typecheck/build): `cd webapp/frontend && npm run build`
Expected: TypeScript compiles and Vite builds `dist/`.

- [ ] **Step 6: Commit**

```bash
git add webapp/README.md webapp/backend/.env.example webapp/scripts/run-prod.ps1 webapp/scripts/run-prod.sh
git commit -m "docs: setup/run docs, env example, and production launch scripts"
```

**M6 demo:** `run-prod` → open `http://127.0.0.1:8000`, full studio served from one process; the health banner flags a missing ffmpeg or an offline worker.

---

## Spec → Task Coverage Map

| Spec requirement | Task(s) |
|------------------|---------|
| FastAPI never imports Torch | M0 T1–T6, enforced; mixdown via numpy (M4 T23) |
| SQLite/WAL queue + persistence | M0 T3, T5 |
| Job model + lifecycle + atomic claim + crash recovery | M0 T5; M1 T12 |
| Upload validation (type/size) + probe | M1 T7, T8 |
| All models / stems exposed | M0 T6 (`/models`); M2 T19 |
| Separation with warm model + device detect | M1 T11, T12 |
| Progress via callback → SSE | M1 T9, T12, T13 |
| CUDA-OOM → segment reduce → CPU fallback | M2 T18 |
| Output formats wav/flac/mp3 + quality + stem subset | M1 T10; M2 T19 |
| Stem download (range) + source download | M1 T14; M4 T24 |
| Studio: synced multitrack, solo/mute/volume, transport, waveforms | M3 T20–T22 |
| Mixdown export (server-side, presets) | M4 T23, T24, T25 |
| A/B vs original | M4 T24 (source route), T25 |
| Library (history/search/reopen/delete) | M5 T26 |
| Batch upload/processing | M5 T27 |
| One-command launch + SPA serving + health | M6 T28, T29 |
| Tests (backend unit/integration, frontend, e2e) | every task (TDD); fixtures M1 T11 |

## Notes on deferred / optional items
- **Playwright E2E** (mentioned in the spec testing section) is optional polish; the per-component Vitest tests plus the manual M-phase demos cover the happy paths. Add a Playwright happy-path spec after M6 if desired — it is not required for any milestone to function.
- **Cancel** is wired in the API (M1 T8) and store; surfacing a cancel button in the Dashboard card is a trivial follow-up using `client.cancelJob`.
