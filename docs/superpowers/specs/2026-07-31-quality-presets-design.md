# Quality Presets for Cleaner Stem Separation

**Date:** 2026-07-31
**Status:** Approved design, pending implementation plan

## Problem

Users hear bleed between stems (most bothersome on drums/bass). The webapp runs
`demucs.api.Separator` with all-default quality settings and defaults to the plain
`htdemucs` model, leaving demucs's built-in quality headroom unused.

Constraints:

- The machine is CPU-only (AMD iGPU, `torch 2.12.1+cpu`); no CUDA path exists.
- Acceptable processing time: up to ~30 minutes for a ~4-minute song.
- Priority: drums/bass bleed reduction. Demucs's hybrid time-domain branch is
  already strongest on these stems, so tuning demucs is the right lever before
  adding a new model family.

## Decision

Expose demucs's two quality parameters (`shifts`, `overlap`) through the job
pipeline plus the `htdemucs_ft` fine-tuned model, surfaced in the UI as a
three-tier quality preset. Defer any new engine (Roformer via `audio-separator`)
to a possible phase 2.

## Design

### Backend: generic knobs, no preset concept server-side

- `JobCreate` gains `shifts: int = 1` and `overlap: float = 0.25`, validated
  (shifts 1–10, overlap 0.1–0.9).
- The `POST /api/jobs` form endpoint accepts matching form fields; `JobOut`
  returns them.
- The `jobs` table gains `shifts INTEGER` and `overlap REAL` columns. Because
  `CREATE TABLE IF NOT EXISTS` won't alter an existing DB, `init_db` performs a
  guarded migration: check `PRAGMA table_info(jobs)` and `ALTER TABLE ... ADD
  COLUMN` for each missing column. Existing rows read back as NULL and are
  treated as the defaults.
- `run_separation_resilient` applies `update_parameter(shifts=..., overlap=...)`
  on **every** job, unconditionally. `ModelCache` reuses Separator instances
  across jobs, so setting parameters only when non-default would leak one job's
  settings into the next.

### Frontend: presets mapped client-side

`Upload.tsx` gains a "Quality" select. A preset is only a client-side bundle of
existing job fields:

| Preset | Model        | shifts | overlap | Est. cost |
|--------|--------------|--------|---------|-----------|
| Fast   | htdemucs     | 1      | 0.25    | ~1x (current behavior) |
| High   | htdemucs_ft  | 1      | 0.25    | ~4x — **new default** |
| Max    | htdemucs_ft  | 2      | 0.5     | ~12x |

- The model dropdown remains for overrides (e.g. `htdemucs_6s`); a manual model
  choice keeps the active preset's shifts/overlap values.
- Preset labels display an estimated time multiplier, replaced with measured
  numbers after calibration (below).

### Progress reporting

With `shifts=2` and a bag of 4 models, the demucs progress callback iterates
more passes than `compute_progress` currently models, which would make the bar
jump backward. `compute_progress` is extended to fold the shift pass index into
the fraction so progress stays monotonic. Covered by unit tests using recorded
callback shapes.

### Calibration (verification step)

After wiring, time each preset on this machine against `test.mp3`:

- If Max exceeds the ~30-minute budget for a typical song, dial its parameters
  back (e.g. `shifts=2, overlap=0.35`) before shipping.
- Put the measured multipliers into the UI copy.

## Testing

Follow existing test patterns in `webapp/backend/tests` and frontend `__tests__`:

- Schema tests: new `JobCreate` fields, validation bounds, `JobOut` round-trip.
- API test: form fields accepted and persisted.
- DB test: `init_db` migrates a pre-existing database (old schema) without data
  loss; new columns readable.
- Engine test: fake separator asserts `shifts`/`overlap` are applied on every
  job, including after a cached-separator reuse.
- Progress tests: monotonic fraction across shift passes and bagged models.
- Frontend Upload test: preset selection maps to the correct job fields; manual
  model override preserves preset knobs.

## Out of scope

- Roformer / `audio-separator` second engine (phase 2 candidate; the generic
  `shifts`/`overlap` job fields added here do not conflict with it).
- Ensembling multiple models and per-stem post-processing (noise gates): cost
  exceeds the CPU budget or hides bleed rather than removing it.
- GPU acceleration: no NVIDIA hardware present.
