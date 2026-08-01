# Stem-Separation Quality Presets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce stem bleed by exposing demucs's `shifts` and `overlap` quality parameters plus the `htdemucs_ft` model through the job pipeline, surfaced in the Upload UI as Fast/High/Max quality presets.

**Architecture:** The backend stays preset-agnostic — `JobCreate`/`JobOut` gain two generic fields (`shifts`, `overlap`) that flow form → SQLite → worker → `Separator.update_parameter(...)`. Presets exist only in the frontend as bundles of `{model, shifts, overlap}`. A guarded `ALTER TABLE` migration adds the two columns to existing databases.

**Tech Stack:** FastAPI + pydantic v2 + sqlite3 (backend), demucs.api (separation), React 18 + TypeScript + vitest + @testing-library/react (frontend), pytest (backend tests).

**Spec:** `docs/superpowers/specs/2026-07-31-quality-presets-design.md`

## Global Constraints

- CPU-only machine (torch `2.12.1+cpu`, no NVIDIA GPU). Never assume CUDA in code or tests.
- Time budget: a ~4-minute song must finish in ~30 minutes on the Max preset (calibrated in Task 7).
- No new dependencies, backend or frontend.
- `shifts` valid range 1–10 (default 1); `overlap` valid range 0.1–0.9 (default 0.25).
- Preset table (initial values; Task 7 may adjust Max and all labels):
  Fast = htdemucs / shifts 1 / overlap 0.25; High (default) = htdemucs_ft / 1 / 0.25; Max = htdemucs_ft / 2 / 0.5.
- Quality parameters are applied to the separator on **every** job (the `ModelCache` reuses `Separator` instances across jobs; conditional application would leak settings between jobs).
- Frontend: edit only `.ts`/`.tsx` files. The `.js` siblings in `webapp/frontend/src` are stale build artifacts — never edit them.
- All backend commands run from `webapp/backend` using `.venv\Scripts\python.exe`; all frontend commands run from `webapp/frontend`.

---

### Task 1: Quality fields on JobCreate / JobOut

**Files:**
- Modify: `webapp/backend/app/core/schemas.py` (JobCreate lines 11–17, JobOut lines 20–41)
- Test: `webapp/backend/tests/test_schemas.py`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `JobCreate.shifts: int` (default 1, ge=1, le=10), `JobCreate.overlap: float` (default 0.25, ge=0.1, le=0.9), `JobOut.shifts: Optional[int] = None`, `JobOut.overlap: Optional[float] = None`. Tasks 2, 3, 5 rely on these exact names.

- [ ] **Step 1: Write the failing tests**

Append to `webapp/backend/tests/test_schemas.py` (file already imports `pytest`, `ValidationError`, `JobCreate`, `JobOut`):

```python
def test_jobcreate_quality_defaults():
    j = JobCreate()
    assert j.shifts == 1
    assert j.overlap == 0.25


def test_jobcreate_rejects_out_of_range_quality():
    with pytest.raises(ValidationError):
        JobCreate(shifts=0)
    with pytest.raises(ValidationError):
        JobCreate(shifts=11)
    with pytest.raises(ValidationError):
        JobCreate(overlap=0.05)
    with pytest.raises(ValidationError):
        JobCreate(overlap=0.95)


def test_jobout_quality_fields_optional():
    row = dict(
        id="a", batch_id=None, created_at="t", updated_at="t", status="queued",
        attempts=0, source_filename="x.mp3", source_format="mp3",
        source_duration=10.0, source_bytes=123, model="htdemucs",
        output_format="wav", output_bitrate=None, output_bitdepth=16,
        requested_stems=None, device_used=None, progress=0.0,
        progress_stage=None, stems=None, error_message=None,
    )
    out = JobOut(**row)  # no shifts/overlap keys at all (old DB row)
    assert out.shifts is None and out.overlap is None
    out2 = JobOut(**row, shifts=2, overlap=0.5)
    assert out2.shifts == 2 and out2.overlap == 0.5
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `webapp/backend`): `.venv\Scripts\python.exe -m pytest tests\test_schemas.py -v`
Expected: the three new tests FAIL (`shifts` attribute missing / no ValidationError raised).

- [ ] **Step 3: Implement**

In `webapp/backend/app/core/schemas.py`:

Change the pydantic import (line 5) to:

```python
from pydantic import BaseModel, Field, model_validator
```

In `JobCreate`, insert after `output_bitdepth: Optional[int] = 16`:

```python
    shifts: int = Field(default=1, ge=1, le=10)
    overlap: float = Field(default=0.25, ge=0.1, le=0.9)
```

In `JobOut`, insert after `output_bitdepth: Optional[int] = None`:

```python
    shifts: Optional[int] = None
    overlap: Optional[float] = None
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv\Scripts\python.exe -m pytest tests\test_schemas.py -v`
Expected: all PASS (including the pre-existing tests).

- [ ] **Step 5: Commit**

```bash
git add webapp/backend/app/core/schemas.py webapp/backend/tests/test_schemas.py
git commit -m "feat(backend): add shifts/overlap quality fields to job schemas"
```

---

### Task 2: DB columns, migration, and persistence

**Files:**
- Modify: `webapp/backend/app/core/db.py` (SCHEMA lines 8–49, `init_db` lines 66–72)
- Modify: `webapp/backend/app/core/jobs.py` (`create_job` lines 24–40)
- Test: `webapp/backend/tests/test_db.py`, `webapp/backend/tests/test_jobs.py`

**Interfaces:**
- Consumes: `JobCreate.shifts` / `JobCreate.overlap` / `JobOut.shifts` / `JobOut.overlap` from Task 1.
- Produces: `jobs` table columns `shifts INTEGER`, `overlap REAL`; `create_job` persists them; `get_job`/`list_jobs` return them via `JobOut`. `init_db(conn)` migrates any pre-existing `jobs` table in place.

- [ ] **Step 1: Write the failing tests**

Append to `webapp/backend/tests/test_db.py`:

```python
OLD_JOBS_SCHEMA = """
CREATE TABLE jobs (
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
"""


def test_init_db_migrates_existing_jobs_table(settings):
    from app.core import jobs

    c = get_connection()
    c.executescript(OLD_JOBS_SCHEMA)  # simulate a database created before this feature
    c.execute(
        "INSERT INTO jobs (id,created_at,updated_at,status,attempts,source_filename,"
        "source_path,model,output_format,progress) "
        "VALUES ('old1','t','t','queued',0,'f.mp3','p','htdemucs','wav',0)"
    )
    c.commit()
    init_db(c)  # must ALTER TABLE, not fail, not drop data
    cols = {r["name"] for r in c.execute("PRAGMA table_info(jobs)")}
    assert {"shifts", "overlap"} <= cols
    job = jobs.get_job(c, "old1")
    assert job is not None
    assert job.shifts is None and job.overlap is None
    c.close()


def test_fresh_db_has_quality_columns(settings):
    c = get_connection()
    init_db(c)
    cols = {r["name"] for r in c.execute("PRAGMA table_info(jobs)")}
    assert {"shifts", "overlap"} <= cols
    c.close()
```

Append to `webapp/backend/tests/test_jobs.py` (it already imports `jobs` and `JobCreate`; if not, add `from app.core import jobs` and `from app.core.schemas import JobCreate` at the top):

```python
def test_job_persists_quality_settings(conn):
    job = jobs.create_job(
        conn, source_filename="a.mp3", source_path="p", source_format="mp3",
        source_duration=1.0, source_bytes=10,
        spec=JobCreate(shifts=2, overlap=0.5),
    )
    assert job.shifts == 2 and job.overlap == 0.5
    fetched = jobs.get_job(conn, job.id)
    assert fetched.shifts == 2 and fetched.overlap == 0.5
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv\Scripts\python.exe -m pytest tests\test_db.py tests\test_jobs.py -v`
Expected: the three new tests FAIL (missing columns / shifts is None).

- [ ] **Step 3: Implement**

In `webapp/backend/app/core/db.py`:

1. In `SCHEMA`, add two lines after `requested_stems TEXT,`:

```sql
  shifts          INTEGER,
  overlap         REAL,
```

2. Add a migration helper and call it from `init_db` (after `executescript`, before `commit`):

```python
_JOBS_COLUMN_MIGRATIONS = {"shifts": "INTEGER", "overlap": "REAL"}


def _migrate(conn: sqlite3.Connection) -> None:
    cols = {r["name"] for r in conn.execute("PRAGMA table_info(jobs)").fetchall()}
    for name, decl in _JOBS_COLUMN_MIGRATIONS.items():
        if name not in cols:
            conn.execute(f"ALTER TABLE jobs ADD COLUMN {name} {decl}")


def init_db(conn: sqlite3.Connection | None = None) -> None:
    own = conn is None
    conn = conn or get_connection()
    conn.executescript(SCHEMA)
    _migrate(conn)
    conn.commit()
    if own:
        conn.close()
```

Note: `_migrate` relies on `conn.row_factory = sqlite3.Row` (set in `get_connection`); the tests' connections come from `get_connection`, so `r["name"]` works.

In `webapp/backend/app/core/jobs.py`, update `create_job`'s INSERT to include the new columns (17 → 19 placeholders):

```python
    conn.execute(
        """INSERT INTO jobs (id,batch_id,created_at,updated_at,status,attempts,
            source_filename,source_path,source_format,source_duration,source_bytes,
            model,output_format,output_bitrate,output_bitdepth,shifts,overlap,
            requested_stems,progress)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (jid, spec.batch_id, now, now, "queued", 0,
         source_filename, str(source_path), source_format, source_duration, source_bytes,
         spec.model, spec.output_format, spec.output_bitrate, spec.output_bitdepth,
         spec.shifts, spec.overlap,
         json.dumps(spec.requested_stems) if spec.requested_stems else None, 0.0),
    )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv\Scripts\python.exe -m pytest tests\test_db.py tests\test_jobs.py -v`
Expected: all PASS.

- [ ] **Step 5: Run the full backend suite (migration touches shared init path)**

Run: `.venv\Scripts\python.exe -m pytest tests -v`
Expected: all PASS (integration tests marked `integration` may skip; that's fine).

- [ ] **Step 6: Commit**

```bash
git add webapp/backend/app/core/db.py webapp/backend/app/core/jobs.py webapp/backend/tests/test_db.py webapp/backend/tests/test_jobs.py
git commit -m "feat(backend): persist shifts/overlap with guarded column migration"
```

---

### Task 3: API accepts quality form fields

**Files:**
- Modify: `webapp/backend/app/api/routes_jobs.py` (`create_job_route` lines 16–53)
- Test: `webapp/backend/tests/test_api_jobs.py`

**Interfaces:**
- Consumes: `JobCreate(shifts=..., overlap=...)` from Task 1; persistence from Task 2.
- Produces: `POST /api/jobs` accepts optional form fields `shifts` (int) and `overlap` (float); response JSON includes `shifts` and `overlap`. Task 6's `createJob` client sends these exact field names.

- [ ] **Step 1: Write the failing test**

Append to `webapp/backend/tests/test_api_jobs.py`:

```python
def test_upload_accepts_quality_fields(settings, monkeypatch):
    monkeypatch.setattr("app.api.routes_jobs.probe", lambda p: (0.1, "wav"))
    client = _client(settings)
    r = client.post(
        "/api/jobs",
        files={"file": ("clip.wav", _wav_bytes(), "audio/wav")},
        data={"model": "htdemucs_ft", "shifts": "2", "overlap": "0.5"},
    )
    assert r.status_code == 200, r.text
    job = r.json()
    assert job["model"] == "htdemucs_ft"
    assert job["shifts"] == 2 and job["overlap"] == 0.5


def test_upload_defaults_quality_fields(settings, monkeypatch):
    monkeypatch.setattr("app.api.routes_jobs.probe", lambda p: (0.1, "wav"))
    client = _client(settings)
    r = client.post("/api/jobs", files={"file": ("clip.wav", _wav_bytes(), "audio/wav")})
    assert r.status_code == 200, r.text
    job = r.json()
    assert job["shifts"] == 1 and job["overlap"] == 0.25
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv\Scripts\python.exe -m pytest tests\test_api_jobs.py -v`
Expected: both new tests FAIL (`shifts` missing from response or None).

- [ ] **Step 3: Implement**

In `webapp/backend/app/api/routes_jobs.py`, add two parameters to `create_job_route` after `output_bitdepth`:

```python
    shifts: int = Form(1),
    overlap: float = Form(0.25),
```

and pass them into the spec:

```python
    spec = JobCreate(
        model=model,
        output_format=output_format,
        output_bitrate=output_bitrate,
        output_bitdepth=output_bitdepth,
        shifts=shifts,
        overlap=overlap,
        requested_stems=[s for s in stems.split(",") if s] if stems else None,
        batch_id=batch_id,
    )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv\Scripts\python.exe -m pytest tests\test_api_jobs.py -v`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add webapp/backend/app/api/routes_jobs.py webapp/backend/tests/test_api_jobs.py
git commit -m "feat(api): accept shifts/overlap quality form fields on job create"
```

---

### Task 4: Shift-aware progress math

**Files:**
- Modify: `webapp/backend/app/worker/progress.py` (whole file, currently 16 lines)
- Test: `webapp/backend/tests/test_progress.py`

**Interfaces:**
- Consumes: nothing new.
- Produces: `compute_progress(d: dict, total_shifts: int = 1) -> Tuple[float, str]`. With the default `total_shifts=1` the math is identical to today (existing callers/tests unaffected). Task 5's engine callback calls it with `total_shifts=shifts`.

Background for the implementer: the demucs progress callback dict contains `models` (bag size), `model_idx_in_bag` (0-based), `shift_idx` (0-based, see `demucs/apply.py:244-251`), `segment_offset`, and `audio_length`. When `shifts=S`, each of the `models` bag members runs `S` full passes, so total passes = `models * S`. The callback does NOT carry the total shift count — only the index — which is why the caller must pass `total_shifts`.

- [ ] **Step 1: Write the failing tests**

Append to `webapp/backend/tests/test_progress.py`:

```python
def test_shift_passes_advance_fraction():
    # bag of 4, 2 shifts: model 0, second shift pass, halfway through audio
    frac, stage = compute_progress(
        {"model_idx_in_bag": 0, "models": 4, "shift_idx": 1,
         "segment_offset": 5, "audio_length": 10, "state": "end"},
        total_shifts=2,
    )
    # (0*2 + 1 + 0.5) / (4*2) = 0.1875
    assert 0.18 <= frac <= 0.20
    assert stage == "model 1/4"


def test_shift_fraction_monotonic_across_bag():
    def frac_at(model_idx, shift_idx, seg):
        f, _ = compute_progress(
            {"model_idx_in_bag": model_idx, "models": 4, "shift_idx": shift_idx,
             "segment_offset": seg, "audio_length": 10, "state": "end"},
            total_shifts=2,
        )
        return f

    seq = [frac_at(m, s, seg) for m in range(4) for s in range(2) for seg in (0, 5, 10)]
    assert seq == sorted(seq)
    assert seq[-1] == 1.0


def test_default_total_shifts_matches_legacy_behavior():
    d = {"model_idx_in_bag": 1, "models": 4, "shift_idx": 0,
         "segment_offset": 0, "audio_length": 10, "state": "end"}
    frac, _ = compute_progress(d)
    assert 0.24 <= frac <= 0.26
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv\Scripts\python.exe -m pytest tests\test_progress.py -v`
Expected: `test_shift_passes_advance_fraction` FAILS with TypeError (unexpected keyword `total_shifts`).

- [ ] **Step 3: Implement**

Replace the body of `webapp/backend/app/worker/progress.py`:

```python
from __future__ import annotations

from typing import Tuple


def compute_progress(d: dict, total_shifts: int = 1) -> Tuple[float, str]:
    models = max(int(d.get("models", 1)), 1)
    shifts = max(int(total_shifts), 1)
    model_idx = int(d.get("model_idx_in_bag", 0))
    shift_idx = int(d.get("shift_idx", 0))
    audio_length = float(d.get("audio_length", 0) or 0)
    segment_offset = float(d.get("segment_offset", 0) or 0)

    seg_frac = (segment_offset / audio_length) if audio_length > 0 else 0.0
    seg_frac = min(max(seg_frac, 0.0), 1.0)
    frac = (model_idx * shifts + shift_idx + seg_frac) / (models * shifts)
    frac = min(max(frac, 0.0), 1.0)
    return frac, f"model {model_idx + 1}/{models}"
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv\Scripts\python.exe -m pytest tests\test_progress.py -v`
Expected: all PASS (including the three pre-existing tests).

- [ ] **Step 5: Commit**

```bash
git add webapp/backend/app/worker/progress.py webapp/backend/tests/test_progress.py
git commit -m "feat(worker): fold shift passes into progress fraction"
```

---

### Task 5: Engine applies quality params every job; worker passes them through

**Files:**
- Modify: `webapp/backend/app/worker/engine.py` (`run_separation` lines 40–52, `run_separation_resilient` lines 69–95)
- Modify: `webapp/backend/app/worker/__main__.py` (`_real_separate` lines 23–34)
- Test: `webapp/backend/tests/test_engine_resilient.py`

**Interfaces:**
- Consumes: `compute_progress(d, total_shifts=...)` from Task 4; `JobOut.shifts`/`JobOut.overlap` from Task 1.
- Produces: `run_separation_resilient(*, source_path, model, device, on_progress, cache, segments=(None, 12, 8), shifts=1, overlap=0.25)` and `run_separation(*, source_path, model, device, on_progress, cache, shifts=1, overlap=0.25)`. Both call `separator.update_parameter(callback=..., shifts=..., overlap=..., segment=...)` on every attempt — including `segment=None` to reset a cached separator that a previous job's OOM fallback left on a small segment (pre-existing leak of the same class the spec calls out).

- [ ] **Step 1: Write the failing tests**

Append to `webapp/backend/tests/test_engine_resilient.py`:

```python
class RecordingSep:
    """Mimics demucs Separator's stateful update_parameter across calls."""

    def __init__(self, fail_times=0):
        self.fail_times = fail_times
        self.calls = 0
        self.samplerate = 44100
        self.current = {}
        self.applied = []  # params snapshot at each separate_audio_file call

    def update_parameter(self, **kw):
        self.current.update(kw)

    def separate_audio_file(self, path):
        self.calls += 1
        self.applied.append(dict(self.current))
        if self.calls <= self.fail_times:
            raise RuntimeError("CUDA error: out of memory")
        return None, {"vocals": object()}


class _SingleSepCache:
    def __init__(self, sep):
        self.sep = sep

    def get(self, model, device):
        return self.sep


def test_quality_params_applied_every_job():
    sep = RecordingSep()
    cache = _SingleSepCache(sep)
    engine.run_separation_resilient(
        source_path="x.wav", model="htdemucs", device="cpu",
        on_progress=lambda f, s: None, cache=cache, shifts=2, overlap=0.5,
    )
    # second job on the SAME cached separator, default quality
    engine.run_separation_resilient(
        source_path="y.wav", model="htdemucs", device="cpu",
        on_progress=lambda f, s: None, cache=cache,
    )
    assert sep.applied[0]["shifts"] == 2 and sep.applied[0]["overlap"] == 0.5
    assert sep.applied[1]["shifts"] == 1 and sep.applied[1]["overlap"] == 0.25


def test_segment_resets_between_jobs_after_oom_fallback():
    sep = RecordingSep(fail_times=1)  # job 1: full segment OOMs, retry succeeds
    cache = _SingleSepCache(sep)
    engine.run_separation_resilient(
        source_path="x.wav", model="htdemucs", device="cuda",
        on_progress=lambda f, s: None, cache=cache, segments=(None, 8),
    )
    assert sep.applied[1]["segment"] == 8
    # job 2 must NOT inherit segment=8 from job 1's fallback
    engine.run_separation_resilient(
        source_path="y.wav", model="htdemucs", device="cuda",
        on_progress=lambda f, s: None, cache=cache, segments=(None, 8),
    )
    assert sep.applied[2]["segment"] is None


def test_progress_callback_uses_total_shifts():
    sep = RecordingSep()
    cache = _SingleSepCache(sep)
    seen = []
    engine.run_separation_resilient(
        source_path="x.wav", model="htdemucs", device="cpu",
        on_progress=lambda f, s: seen.append(f), cache=cache, shifts=2,
    )
    cb = sep.current["callback"]
    cb({"state": "end", "models": 4, "model_idx_in_bag": 0, "shift_idx": 1,
        "segment_offset": 0, "audio_length": 10})
    # (0*2 + 1 + 0) / (4*2) = 0.125
    assert seen and abs(seen[-1] - 0.125) < 0.01
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv\Scripts\python.exe -m pytest tests\test_engine_resilient.py -v`
Expected: 3 new tests FAIL (unexpected keyword `shifts` / missing `segment` key / wrong fraction). The 2 pre-existing tests still PASS.

- [ ] **Step 3: Implement**

In `webapp/backend/app/worker/engine.py`, replace `run_separation` and `run_separation_resilient`:

```python
def run_separation(*, source_path: str, model: str, device: str,
                   on_progress: Callable[[float, str], None],
                   cache: ModelCache, shifts: int = 1,
                   overlap: float = 0.25) -> Tuple[Dict[str, object], int]:
    separator = cache.get(model, device)

    def _cb(d: dict) -> None:
        if d.get("state") == "end":
            frac, stage = compute_progress(d, total_shifts=shifts)
            on_progress(frac, stage)

    separator.update_parameter(callback=_cb, shifts=shifts, overlap=overlap)
    _origin, separated = separator.separate_audio_file(source_path)
    return separated, separator.samplerate
```

```python
def run_separation_resilient(*, source_path, model, device, on_progress, cache,
                             segments=(None, 12, 8), shifts=1, overlap=0.25):
    devices = [device, "cpu"] if device == "cuda" else ["cpu"]
    last_err = None
    for dev in devices:
        seg_list = segments if dev == "cuda" else (None,)
        for seg in seg_list:
            separator = cache.get(model, dev)

            def _cb(d: dict) -> None:
                if d.get("state") == "end":
                    frac, stage = compute_progress(d, total_shifts=shifts)
                    on_progress(frac, stage)

            # Set every parameter on every attempt: cached Separator instances
            # keep their previous values otherwise (segment=None restores the
            # model's default segment length).
            separator.update_parameter(callback=_cb, shifts=shifts,
                                       overlap=overlap, segment=seg)
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

In `webapp/backend/app/worker/__main__.py`, update `_real_separate`:

```python
def _real_separate(cache):
    from app.worker import engine

    def fn(job, on_progress):
        stems, sr, used = engine.run_separation_resilient(
            source_path=job.source_path, model=job.model,
            device=job.device_used or engine.detect_device(),
            on_progress=on_progress, cache=cache,
            shifts=job.shifts or 1, overlap=job.overlap or 0.25,
        )
        return stems, sr

    return fn
```

(`job.shifts`/`job.overlap` are `None` for rows created before the migration; `or` falls back to the defaults.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv\Scripts\python.exe -m pytest tests\test_engine_resilient.py tests\test_engine.py tests\test_worker_loop.py -v`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add webapp/backend/app/worker/engine.py webapp/backend/app/worker/__main__.py webapp/backend/tests/test_engine_resilient.py
git commit -m "feat(worker): apply shifts/overlap per job and reset segment between jobs"
```

---

### Task 6: Frontend quality presets

**Files:**
- Modify: `webapp/frontend/src/types.ts` (Job lines 4–17, CreateJobOpts lines 25–32)
- Modify: `webapp/frontend/src/api/client.ts` (`createJob` lines 20–30)
- Modify: `webapp/frontend/src/screens/Upload.tsx` (whole component)
- Test: `webapp/frontend/src/screens/__tests__/Upload.test.tsx`

**Interfaces:**
- Consumes: form fields `shifts`/`overlap` on `POST /api/jobs` from Task 3.
- Produces: `CreateJobOpts.shifts?: number`, `CreateJobOpts.overlap?: number`; Upload UI preset select (aria-label `"quality"`), model select gains aria-label `"model"`. Task 7 edits the `PRESETS` constant defined here.

- [ ] **Step 1: Update existing tests and write the failing tests**

The default model changes to `htdemucs_ft` (High preset), so the three existing tests' `listModels` mocks must list it or the stem checkboxes render empty. In `webapp/frontend/src/screens/__tests__/Upload.test.tsx`, replace every occurrence of:

```tsx
    vi.spyOn(client, "listModels").mockResolvedValue([
      { name: "htdemucs", stems: ["drums", "bass", "other", "vocals"], description: "" },
    ]);
```

with:

```tsx
    vi.spyOn(client, "listModels").mockResolvedValue([
      { name: "htdemucs", stems: ["drums", "bass", "other", "vocals"], description: "" },
      { name: "htdemucs_ft", stems: ["drums", "bass", "other", "vocals"], description: "" },
    ]);
```

Then append these tests inside the `describe("Upload", ...)` block:

```tsx
  it("defaults to the High preset (htdemucs_ft, shifts 1, overlap 0.25)", async () => {
    vi.spyOn(client, "listModels").mockResolvedValue([
      { name: "htdemucs", stems: ["drums", "bass", "other", "vocals"], description: "" },
      { name: "htdemucs_ft", stems: ["drums", "bass", "other", "vocals"], description: "" },
    ]);
    const create = vi.spyOn(client, "createJob").mockResolvedValue({
      id: "j4", status: "queued", source_filename: "s.mp3",
      model: "htdemucs_ft", output_format: "wav", progress: 0,
    });
    render(<Upload onCreated={vi.fn()} />);
    await screen.findByLabelText("vocals");
    fireEvent.change(screen.getByTestId("file-input"), {
      target: { files: [new File([new Uint8Array([1])], "s.mp3")] },
    });
    fireEvent.click(screen.getByText(/separate/i));
    await waitFor(() => expect(create).toHaveBeenCalled());
    const opts = create.mock.calls[0][1];
    expect(opts.model).toBe("htdemucs_ft");
    expect(opts.shifts).toBe(1);
    expect(opts.overlap).toBe(0.25);
  });

  it("Max preset sends shifts 2 and overlap 0.5", async () => {
    vi.spyOn(client, "listModels").mockResolvedValue([
      { name: "htdemucs", stems: ["drums", "bass", "other", "vocals"], description: "" },
      { name: "htdemucs_ft", stems: ["drums", "bass", "other", "vocals"], description: "" },
    ]);
    const create = vi.spyOn(client, "createJob").mockResolvedValue({
      id: "j5", status: "queued", source_filename: "s.mp3",
      model: "htdemucs_ft", output_format: "wav", progress: 0,
    });
    render(<Upload onCreated={vi.fn()} />);
    await screen.findByLabelText("vocals");
    fireEvent.change(screen.getByLabelText("quality"), { target: { value: "max" } });
    fireEvent.change(screen.getByTestId("file-input"), {
      target: { files: [new File([new Uint8Array([1])], "s.mp3")] },
    });
    fireEvent.click(screen.getByText(/separate/i));
    await waitFor(() => expect(create).toHaveBeenCalled());
    const opts = create.mock.calls[0][1];
    expect(opts.model).toBe("htdemucs_ft");
    expect(opts.shifts).toBe(2);
    expect(opts.overlap).toBe(0.5);
  });

  it("manual model override keeps the preset quality knobs", async () => {
    vi.spyOn(client, "listModels").mockResolvedValue([
      { name: "htdemucs", stems: ["drums", "bass", "other", "vocals"], description: "" },
      { name: "htdemucs_ft", stems: ["drums", "bass", "other", "vocals"], description: "" },
    ]);
    const create = vi.spyOn(client, "createJob").mockResolvedValue({
      id: "j6", status: "queued", source_filename: "s.mp3",
      model: "htdemucs", output_format: "wav", progress: 0,
    });
    render(<Upload onCreated={vi.fn()} />);
    await screen.findByLabelText("vocals");
    fireEvent.change(screen.getByLabelText("model"), { target: { value: "htdemucs" } });
    fireEvent.change(screen.getByTestId("file-input"), {
      target: { files: [new File([new Uint8Array([1])], "s.mp3")] },
    });
    fireEvent.click(screen.getByText(/separate/i));
    await waitFor(() => expect(create).toHaveBeenCalled());
    const opts = create.mock.calls[0][1];
    expect(opts.model).toBe("htdemucs");
    expect(opts.shifts).toBe(1); // High preset knobs retained
    expect(opts.overlap).toBe(0.25);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `webapp/frontend`): `npx vitest run src/screens/__tests__/Upload.test.tsx`
Expected: the 3 new tests FAIL (no `quality` select; `opts.shifts` undefined).

- [ ] **Step 3: Implement types and client**

In `webapp/frontend/src/types.ts`, add to `Job` after `output_format: OutputFormat;`:

```ts
  shifts?: number | null;
  overlap?: number | null;
```

and add to `CreateJobOpts` after `output_bitdepth?: number;`:

```ts
  shifts?: number;
  overlap?: number;
```

In `webapp/frontend/src/api/client.ts`, add to `createJob` after the `output_bitdepth` line:

```ts
  if (opts.shifts != null) fd.append("shifts", String(opts.shifts));
  if (opts.overlap != null) fd.append("overlap", String(opts.overlap));
```

- [ ] **Step 4: Implement the Upload component**

Replace `webapp/frontend/src/screens/Upload.tsx` with:

```tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createJob, listModels } from "../api/client";
import type { Job, ModelInfo, OutputFormat } from "../types";

type PresetName = "fast" | "high" | "max";

// Estimated multipliers pending calibration on this machine (see plan Task 7).
export const PRESETS: Record<
  PresetName,
  { model: string; shifts: number; overlap: number; label: string }
> = {
  fast: { model: "htdemucs", shifts: 1, overlap: 0.25, label: "Fast (~1x)" },
  high: { model: "htdemucs_ft", shifts: 1, overlap: 0.25, label: "High quality (~4x)" },
  max: { model: "htdemucs_ft", shifts: 2, overlap: 0.5, label: "Max quality (~12x)" },
};

export function Upload({ onCreated }: { onCreated: (j: Job) => void }) {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [preset, setPreset] = useState<PresetName>("high");
  const [model, setModel] = useState(PRESETS.high.model);
  const [format, setFormat] = useState<OutputFormat>("wav");
  const [bitrate, setBitrate] = useState(320);
  const [bitdepth, setBitdepth] = useState(16);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

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
            shifts: PRESETS[preset].shifts,
            overlap: PRESETS[preset].overlap,
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

  return (
    <div className="upload">
      <div className="upload-pick-row">
        <input
          ref={inputRef}
          data-testid="file-input"
          type="file"
          multiple
          accept=".mp3,.flac,.wav,.ogg,.m4a"
          onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
          style={{ display: "none" }}
        />
        <button
          type="button"
          className="btn-load-track"
          onClick={() => inputRef.current?.click()}
        >
          Load Track
        </button>
        <span className="upload-picked">
          {files.length === 0
            ? "No tracks selected"
            : files.length === 1
              ? files[0].name
              : `${files.length} tracks selected`}
        </span>
      </div>
      <select
        aria-label="quality"
        value={preset}
        onChange={(e) => {
          const p = e.target.value as PresetName;
          setPreset(p);
          setModel(PRESETS[p].model);
        }}
      >
        {(Object.keys(PRESETS) as PresetName[]).map((p) => (
          <option key={p} value={p}>{PRESETS[p].label}</option>
        ))}
      </select>
      <select aria-label="model" value={model} onChange={(e) => setModel(e.target.value)}>
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
      <button className="btn-primary" onClick={submit} disabled={files.length === 0 || busy}>
        {files.length > 1 ? `Separate ${files.length} files` : "Separate"}
      </button>
    </div>
  );
}
```

- [ ] **Step 5: Run the frontend suite to verify everything passes**

Run (from `webapp/frontend`): `npx vitest run`
Expected: all PASS, including the three updated pre-existing Upload tests.

- [ ] **Step 6: Commit**

```bash
git add webapp/frontend/src/types.ts webapp/frontend/src/api/client.ts webapp/frontend/src/screens/Upload.tsx webapp/frontend/src/screens/__tests__/Upload.test.tsx
git commit -m "feat(frontend): quality preset selector (Fast/High/Max) on upload"
```

---

### Task 7: Calibrate presets on this machine

**Files:**
- Create (scratchpad only, NOT committed): `<scratchpad>/bench.py`, `<scratchpad>/clip15.wav`
- Modify: `webapp/frontend/src/screens/Upload.tsx` (the `PRESETS` constant from Task 6)
- Test: `webapp/frontend/src/screens/__tests__/Upload.test.tsx` (only if Max's parameters change)

**Interfaces:**
- Consumes: `PRESETS` constant from Task 6; repo-root `test.mp3` as source audio.
- Produces: measured per-preset timings; final Max parameters and honest preset labels.

Background: separation time scales linearly with audio duration, so a 15-second clip predicts a 4-minute (240 s) song at 16x the measured time. `Separator(...)` loads model weights in its constructor (first `htdemucs_ft` use downloads ~330 MB), so the script times only `separate_audio_file`.

- [ ] **Step 1: Create the 15-second benchmark clip**

From the repo root (ffmpeg is a checked app dependency):

```bash
ffmpeg -y -i test.mp3 -t 15 -ac 2 -ar 44100 "<scratchpad>/clip15.wav"
```

- [ ] **Step 2: Write the benchmark script**

Save as `<scratchpad>/bench.py`:

```python
import sys
import time

import demucs.api

clip, model, shifts, overlap = (
    sys.argv[1], sys.argv[2], int(sys.argv[3]), float(sys.argv[4])
)
sep = demucs.api.Separator(model=model, device="cpu", shifts=shifts, overlap=overlap)
t0 = time.perf_counter()
sep.separate_audio_file(clip)
dt = time.perf_counter() - t0
print(f"{model} shifts={shifts} overlap={overlap}: {dt:.1f}s "
      f"(~{dt * 16 / 60:.1f} min for a 4-minute song)")
```

- [ ] **Step 3: Benchmark each preset**

Run from `webapp/backend`, one preset per command. Fast should take ~1–2 min; High several minutes; Max possibly longer — use a 600000 ms timeout and run Max in the background if needed:

```bash
.venv/Scripts/python.exe "<scratchpad>/bench.py" "<scratchpad>/clip15.wav" htdemucs 1 0.25
.venv/Scripts/python.exe "<scratchpad>/bench.py" "<scratchpad>/clip15.wav" htdemucs_ft 1 0.25
.venv/Scripts/python.exe "<scratchpad>/bench.py" "<scratchpad>/clip15.wav" htdemucs_ft 2 0.5
```

Record all three extrapolated 4-minute-song times.

- [ ] **Step 4: Apply the decision rule**

- If Max's extrapolated time ≤ 30 min: keep `shifts: 2, overlap: 0.5`.
- If over 30 min: change Max in `PRESETS` to `shifts: 2, overlap: 0.35`, re-run the Max benchmark line with `2 0.35`; if still over, use `shifts: 2, overlap: 0.25`.
- If Max's parameters changed, update the `overlap` expectation in the Upload test "Max preset sends shifts 2 and overlap 0.5" (and its title) to match.

- [ ] **Step 5: Put measured numbers into the preset labels**

Update the three `label` strings in `PRESETS` (Task 6, `Upload.tsx`) with the measured multipliers relative to Fast, rounded to the nearest integer — e.g. `"High quality (~4x slower)"` → `"High quality (~5x slower)"` if that's what was measured. Keep the format `"<Name> (~Nx)"` so the UI copy stays compact.

- [ ] **Step 6: Run the frontend suite**

Run (from `webapp/frontend`): `npx vitest run`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add webapp/frontend/src/screens/Upload.tsx webapp/frontend/src/screens/__tests__/Upload.test.tsx
git commit -m "chore(frontend): calibrate quality preset labels from CPU benchmarks"
```

---

## Final verification (after all tasks)

- [ ] Backend: `.venv\Scripts\python.exe -m pytest tests -v` from `webapp/backend` — all pass.
- [ ] Frontend: `npx vitest run` from `webapp/frontend` — all pass.
- [ ] Frontend type-check/build: `npm run build` from `webapp/frontend` — no type errors.
- [ ] End-to-end smoke test: start the app (`webapp/scripts/run-dev.ps1`), upload `test.mp3` with the Fast preset, and confirm the job completes, the response JSON shows `shifts`/`overlap`, and the progress bar advances monotonically.
