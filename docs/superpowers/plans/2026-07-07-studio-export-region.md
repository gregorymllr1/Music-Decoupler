# Studio Export Region Markers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add draggable start/end markers to the Studio timeline that scope the mixdown export to a fragment of the song, with a "Play selection" audition control, per `docs/superpowers/specs/2026-07-07-studio-export-region-design.md`.

**Architecture:** The frontend gains a `RegionTimeline` ruler above the track rows (draggable handles + playhead + shaded selection), region state in `useStudioEngine` (single clamping point), a dimming overlay across the waveform column, and bounded playback in `StudioEngine`. The backend's existing server-side mixdown renderer gains optional `start_sec`/`end_sec` that slice the mixed numpy array before encoding.

**Tech Stack:** React + TypeScript + Vite, Vitest + React Testing Library (jsdom), Web Audio API. Backend: FastAPI, pydantic v2, numpy, soundfile, pytest.

## Global Constraints

- **TDD is mandatory:** write the failing test first, watch it fail, implement the minimum, watch it pass, commit. Conventional Commits (`feat:`, `test:`, `fix:`).
- **Run backend commands from `webapp/backend/`** using the venv interpreter: `.venv\Scripts\python -m pytest ...` (Windows). **Run frontend commands from `webapp/frontend/`** (`npx vitest run ...`).
- **Region invariants:** `0 ≤ start < end ≤ duration`, minimum gap **0.1 s**. All frontend clamping happens in `useStudioEngine.setRegion` — components pass raw values through.
- **Back-compat:** a full-width region (within 0.05 s of the edges) must produce a `MixdownRequest` with **no** `start_sec`/`end_sec` keys — byte-identical to today's requests.
- **Backend re-clamps defensively** against actual audio length; an empty range yields a 1-frame silent file (mirrors the existing all-muted behavior), not an error.
- **Python 3.8-compatible runtime code.** `mix.py` has `from __future__ import annotations`, so `float | None` **annotations** are fine, but do not use `X | Y` in runtime positions.
- **The working tree has unrelated uncommitted changes** (`Upload.tsx`, `Upload.test.tsx`, `styles.css`, `vite.config.ts`, `run-dev.ps1`). `git add` only the files named in each task — never `git add -A`.
- **jsdom quirks:** no `PointerEvent` and no `setPointerCapture` — the RegionTimeline test polyfills `PointerEvent`; the component calls `setPointerCapture?.()` optionally. No jest-dom setup file exists, so use `expect(...).toBeTruthy()`, not `toBeInTheDocument()`.

---

## File Structure

```
webapp/
  backend/
    app/core/mix.py                 # MODIFY: _slice_range() + render_mixdown(start_sec, end_sec)
    app/core/schemas.py             # MODIFY: MixdownRequest.start_sec/end_sec + validator
    app/api/routes_mixdown.py       # MODIFY: pass range through to render_mixdown
    tests/test_mix.py               # MODIFY: range slicing tests
    tests/test_schemas.py           # MODIFY: range validation tests
    tests/test_api_mixdown.py       # MODIFY: ranged-mixdown route test
  frontend/src/
    types.ts                        # MODIFY: MixdownRequest.start_sec?/end_sec?
    studio/StudioEngine.ts          # MODIFY: play(stopAt?), playSelection(start, end)
    studio/useStudioEngine.ts       # MODIFY: region state, setRegion/resetRegion/playSelection,
                                    #         ranged buildMixdownRequest
    studio/time.ts                  # CREATE: shared fmtTime()
    studio/RegionTimeline.tsx       # CREATE: ruler with handles, shade, playhead
    studio/Transport.tsx            # MODIFY: "play selection" button; use shared fmtTime
    studio/ExportPanel.tsx          # MODIFY: optional rangeSummary display
    screens/Studio.tsx              # MODIFY: wire ruler, overlay, transport, export summary
    styles.css                      # MODIFY: --track-gutter var, ruler/handle/overlay styles
    studio/__tests__/StudioEngine.test.ts     # MODIFY: bounded playback tests
    studio/__tests__/useStudioEngine.test.ts  # MODIFY: region state tests
    studio/__tests__/RegionTimeline.test.tsx  # CREATE
    studio/__tests__/Controls.test.tsx        # MODIFY: transport button tests
    studio/__tests__/ab_export.test.tsx       # MODIFY: range summary test
```

---

### Task 1: Backend — range slicing in the mixdown renderer

**Files:**
- Modify: `webapp/backend/app/core/mix.py`
- Test: `webapp/backend/tests/test_mix.py`

**Interfaces:**
- Consumes: existing `mix_tracks(tracks, resolve_path) -> (np.ndarray, int)`.
- Produces: `render_mixdown(tracks, resolve_path, out_path, fmt, bitrate=320, bitdepth=16, start_sec=None, end_sec=None) -> Path` — Task 2's route calls it with the two new keyword args.

- [ ] **Step 1: Write the failing tests**

Append to `webapp/backend/tests/test_mix.py`:

```python
def test_render_range_slices_frames(tmp_path):
    _write(tmp_path / "a.wav", 0.2, frames=44100)  # 1.0 s of audio
    resolve = lambda stem: tmp_path / f"{stem}.wav"
    out = mix.render_mixdown(
        [MixdownTrack(stem="a")], resolve, tmp_path / "mix.wav", "wav",
        start_sec=0.25, end_sec=0.75,
    )
    data, sr = sf.read(str(out))
    assert sr == 44100
    assert data.shape[0] == int(0.75 * 44100) - int(0.25 * 44100)


def test_render_range_clamps_to_audio_length(tmp_path):
    _write(tmp_path / "a.wav", 0.2)  # default 4410 frames = 0.1 s
    resolve = lambda stem: tmp_path / f"{stem}.wav"
    out = mix.render_mixdown(
        [MixdownTrack(stem="a")], resolve, tmp_path / "mix.wav", "wav",
        start_sec=0.05, end_sec=99.0,
    )
    data, _ = sf.read(str(out))
    assert data.shape[0] == 4410 - int(0.05 * 44100)


def test_render_range_past_end_yields_silence(tmp_path):
    _write(tmp_path / "a.wav", 0.2)  # 0.1 s
    resolve = lambda stem: tmp_path / f"{stem}.wav"
    out = mix.render_mixdown(
        [MixdownTrack(stem="a")], resolve, tmp_path / "mix.wav", "wav",
        start_sec=5.0, end_sec=6.0,
    )
    data, _ = sf.read(str(out), always_2d=True)
    assert data.shape[0] == 1
    assert float(abs(data).max()) == 0.0
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `webapp/backend/`): `.venv\Scripts\python -m pytest tests/test_mix.py -v`
Expected: the 3 new tests FAIL with `TypeError: render_mixdown() got an unexpected keyword argument 'start_sec'`; the 3 existing tests still PASS.

- [ ] **Step 3: Implement slicing**

In `webapp/backend/app/core/mix.py`, add `_slice_range` above `render_mixdown` and update `render_mixdown`:

```python
def _slice_range(mix: np.ndarray, sr: int,
                 start_sec: float | None, end_sec: float | None) -> np.ndarray:
    begin = int(start_sec * sr) if start_sec is not None else 0
    stop = int(end_sec * sr) if end_sec is not None else mix.shape[0]
    begin = max(0, min(begin, mix.shape[0]))
    stop = max(begin, min(stop, mix.shape[0]))
    out = mix[begin:stop]
    if out.shape[0] == 0:
        return np.zeros((1, mix.shape[1]), dtype="float32")
    return out


def render_mixdown(tracks: List, resolve_path: Callable, out_path, fmt: str,
                   bitrate: int = 320, bitdepth: int = 16,
                   start_sec: float | None = None, end_sec: float | None = None) -> Path:
    mix, sr = mix_tracks(tracks, resolve_path)
    mix = _slice_range(mix, sr, start_sec, end_sec)
    write_audio(mix, sr, out_path, fmt, bitrate, bitdepth)
    return Path(out_path)
```

(`float | None` annotations are safe here: the file already has `from __future__ import annotations`.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv\Scripts\python -m pytest tests/test_mix.py -v`
Expected: all 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add webapp/backend/app/core/mix.py webapp/backend/tests/test_mix.py
git commit -m "feat(backend): render_mixdown supports start_sec/end_sec range slicing"
```

---

### Task 2: Backend — MixdownRequest range fields and route pass-through

**Files:**
- Modify: `webapp/backend/app/core/schemas.py` (MixdownRequest, ~line 50)
- Modify: `webapp/backend/app/api/routes_mixdown.py` (~line 33)
- Test: `webapp/backend/tests/test_schemas.py`, `webapp/backend/tests/test_api_mixdown.py`

**Interfaces:**
- Consumes: `render_mixdown(..., start_sec=..., end_sec=...)` from Task 1.
- Produces: API accepts optional `start_sec`/`end_sec` (floats, seconds) in `POST /api/jobs/{jid}/mixdown`; invalid ranges → HTTP 422. The frontend (Task 4) sends these exact key names.

- [ ] **Step 1: Write the failing schema tests**

Append to `webapp/backend/tests/test_schemas.py` (add the two imports at the top of the file):

```python
import pytest
from pydantic import ValidationError


def test_mixdown_request_accepts_valid_range():
    m = MixdownRequest(tracks=[{"stem": "v"}], start_sec=1.0, end_sec=2.5)
    assert m.start_sec == 1.0
    assert m.end_sec == 2.5


def test_mixdown_request_defaults_have_no_range():
    m = MixdownRequest(tracks=[{"stem": "v"}])
    assert m.start_sec is None and m.end_sec is None


def test_mixdown_request_rejects_bad_ranges():
    with pytest.raises(ValidationError):
        MixdownRequest(tracks=[{"stem": "v"}], start_sec=-1.0)
    with pytest.raises(ValidationError):
        MixdownRequest(tracks=[{"stem": "v"}], start_sec=2.0, end_sec=2.0)
    with pytest.raises(ValidationError):
        MixdownRequest(tracks=[{"stem": "v"}], end_sec=0.0)
```

- [ ] **Step 2: Write the failing route tests**

Append to `webapp/backend/tests/test_api_mixdown.py` (add `import io` at the top):

```python
def test_create_mixdown_with_range(settings):
    job = _finished_job(settings)  # stems are 4410 frames (0.1 s) at 44100 Hz
    client = TestClient(create_app())
    r = client.post(
        f"/api/jobs/{job.id}/mixdown",
        json={"name": "clip", "format": "wav", "start_sec": 0.02, "end_sec": 0.06,
              "tracks": [{"stem": "drums", "gain": 1.0, "muted": False}]},
    )
    assert r.status_code == 200, r.text
    dl = client.get(f"/api/mixdowns/{r.json()['id']}/download")
    assert dl.status_code == 200
    data, sr = sf.read(io.BytesIO(dl.content))
    assert sr == 44100
    assert data.shape[0] == int(0.06 * 44100) - int(0.02 * 44100)


def test_create_mixdown_rejects_invalid_range(settings):
    job = _finished_job(settings)
    client = TestClient(create_app())
    r = client.post(
        f"/api/jobs/{job.id}/mixdown",
        json={"name": "clip", "format": "wav", "start_sec": 3.0, "end_sec": 1.0,
              "tracks": [{"stem": "drums", "gain": 1.0, "muted": False}]},
    )
    assert r.status_code == 422
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `.venv\Scripts\python -m pytest tests/test_schemas.py tests/test_api_mixdown.py -v`
Expected: `test_mixdown_request_accepts_valid_range` FAILS (`start_sec` attribute missing), `test_mixdown_request_rejects_bad_ranges` FAILS (no ValidationError raised), `test_create_mixdown_with_range` FAILS (frame count = 4410, unsliced), `test_create_mixdown_rejects_invalid_range` FAILS (200 not 422). Existing tests PASS.

- [ ] **Step 4: Implement schema + route**

In `webapp/backend/app/core/schemas.py`, change the pydantic import to `from pydantic import BaseModel, model_validator` and replace `MixdownRequest` with:

```python
class MixdownRequest(BaseModel):
    name: str = "mixdown"
    format: OutputFormat = "mp3"
    bitrate: Optional[int] = 320
    bitdepth: Optional[int] = 16
    start_sec: Optional[float] = None
    end_sec: Optional[float] = None
    tracks: List[MixdownTrack]

    @model_validator(mode="after")
    def _validate_range(self):
        if self.start_sec is not None and self.start_sec < 0:
            raise ValueError("start_sec must be >= 0")
        if self.end_sec is not None and self.end_sec <= (self.start_sec or 0.0):
            raise ValueError("end_sec must be greater than start_sec")
        return self
```

In `webapp/backend/app/api/routes_mixdown.py`, update the `render_mixdown` call:

```python
        mix.render_mixdown([t for t in req.tracks], resolve, out, req.format,
                           bitrate=req.bitrate or 320, bitdepth=req.bitdepth or 16,
                           start_sec=req.start_sec, end_sec=req.end_sec)
```

- [ ] **Step 5: Run the full backend suite**

Run: `.venv\Scripts\python -m pytest -q`
Expected: all tests PASS (the stored `spec_json` already serializes the whole request via `model_dump()`, so no other change is needed).

- [ ] **Step 6: Commit**

```bash
git add webapp/backend/app/core/schemas.py webapp/backend/app/api/routes_mixdown.py webapp/backend/tests/test_schemas.py webapp/backend/tests/test_api_mixdown.py
git commit -m "feat(backend): optional start_sec/end_sec range on mixdown requests"
```

---

### Task 3: Frontend — bounded playback in StudioEngine

**Files:**
- Modify: `webapp/frontend/src/studio/StudioEngine.ts`
- Test: `webapp/frontend/src/studio/__tests__/StudioEngine.test.ts`

**Interfaces:**
- Produces: `play(stopAt?: number): void` (sample-accurate stop via `src.start(0, offset, stopAt - offset)`), `playSelection(start: number, end: number): void`. Task 4's hook calls `engine.playSelection(region.start, region.end)`. Existing `pause()/stop()/seek()` signatures unchanged.

- [ ] **Step 1: Extend the fake context and write the failing tests**

In `webapp/frontend/src/studio/__tests__/StudioEngine.test.ts`, update `FakeCtx` to record created sources:

```ts
class FakeCtx {
  currentTime = 0;
  destination = {};
  sources: FakeSource[] = [];
  createGain = () => new FakeGain();
  createBufferSource = () => {
    const s = new FakeSource();
    this.sources.push(s);
    return s;
  };
}
```

Append inside the `describe("StudioEngine", ...)` block:

```ts
  it("play with stopAt schedules bounded sources", () => {
    engine.seek(2);
    engine.play(8);
    expect(ctx.sources[0].start).toHaveBeenCalledWith(0, 2, 6);
  });

  it("flips to paused at stopAt when sources end", () => {
    engine.play(8);
    ctx.currentTime = 8;
    ctx.sources[0].onended?.();
    expect(engine.isPlaying).toBe(false);
    expect(engine.currentTime).toBe(8);
  });

  it("currentTime never reads past stopAt while playing", () => {
    engine.play(8);
    ctx.currentTime = 9.5;
    expect(engine.currentTime).toBe(8);
  });

  it("manual pause before stopAt keeps the paused position", () => {
    engine.play(8);
    ctx.currentTime = 3;
    engine.pause();
    ctx.sources[0].onended?.(); // fires async after stop() in real browsers
    expect(engine.isPlaying).toBe(false);
    expect(engine.currentTime).toBeCloseTo(3, 5);
  });

  it("playSelection seeks to start and bounds playback at end", () => {
    engine.playSelection(2, 8);
    expect(engine.isPlaying).toBe(true);
    expect(engine.currentTime).toBeCloseTo(2, 5);
    expect(ctx.sources[0].start).toHaveBeenCalledWith(0, 2, 6);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `webapp/frontend/`): `npx vitest run src/studio/__tests__/StudioEngine.test.ts`
Expected: the 5 new tests FAIL — `playSelection is not a function`, bounded `start` called with 2 args not 3, `currentTime` reads 9.5, etc. The 5 existing tests PASS.

- [ ] **Step 3: Implement bounded playback**

In `webapp/frontend/src/studio/StudioEngine.ts`:

Add two private fields after `private startedAt = 0;`:

```ts
  private stopAtTime: number | null = null; // bounded-playback stop point (seconds)
  private playToken = 0; // invalidates stale onended callbacks
```

Replace the `currentTime` getter:

```ts
  get currentTime(): number {
    const raw = this.playing ? this.ctx.currentTime - this.startedAt : this.offset;
    return this.playing && this.stopAtTime != null ? Math.min(raw, this.stopAtTime) : raw;
  }
```

Replace `play()` and `pause()`:

```ts
  play(stopAt?: number): void {
    if (this.playing) return;
    this.startedAt = this.ctx.currentTime - this.offset;
    this.stopAtTime = stopAt != null && stopAt > this.offset ? stopAt : null;
    const token = ++this.playToken;
    let first = true;
    for (const t of this.allTracks()) {
      const src = this.ctx.createBufferSource();
      src.buffer = t.buffer;
      src.connect(t.gainNode);
      if (this.stopAtTime != null) {
        src.start(0, this.offset, this.stopAtTime - this.offset);
        if (first) {
          src.onended = () => {
            if (this.playToken === token && this.playing) this.pause();
          };
        }
      } else {
        src.start(0, this.offset);
      }
      t.source = src;
      first = false;
    }
    this.applyGains();
    this.playing = true;
  }

  pause(): void {
    if (!this.playing) return;
    this.offset = this.currentTime; // clamped to stopAtTime when bounded
    this.stopAtTime = null;
    for (const t of this.allTracks()) {
      const src = t.source;
      t.source = null;
      if (src) {
        src.onended = null;
        src.stop();
      }
    }
    this.playing = false;
  }
```

Add after `seek()`:

```ts
  playSelection(start: number, end: number): void {
    if (this.playing) this.pause();
    this.offset = Math.max(0, Math.min(start, this.duration));
    this.play(Math.min(end, this.duration));
  }
```

Note: seeking during an audition intentionally cancels the bound (seek pauses, which clears `stopAtTime`, then resumes unbounded) — normal seek behavior is unchanged per the spec.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/studio/__tests__/StudioEngine.test.ts`
Expected: all 10 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add webapp/frontend/src/studio/StudioEngine.ts webapp/frontend/src/studio/__tests__/StudioEngine.test.ts
git commit -m "feat(studio): sample-accurate bounded playback and playSelection in engine"
```

---

### Task 4: Frontend — region state in useStudioEngine + ranged request type

**Files:**
- Modify: `webapp/frontend/src/types.ts`
- Modify: `webapp/frontend/src/studio/useStudioEngine.ts`
- Test: `webapp/frontend/src/studio/__tests__/useStudioEngine.test.ts`

**Interfaces:**
- Consumes: `engine.playSelection(start, end)` and `engine.duration` from Task 3.
- Produces (used by Tasks 5–6): hook returns `region: { start: number; end: number }`, `setRegion(start: number, end: number): void` (the single clamping point), `resetRegion(): void`, `playSelection(): void`; `buildMixdownRequest` adds `start_sec`/`end_sec` only when the region is narrower than the full track (0.05 s edge epsilon). `MixdownRequest` in `types.ts` gains `start_sec?: number; end_sec?: number;`.

- [ ] **Step 1: Write the failing tests**

Append inside the `describe("useStudioEngine", ...)` block of `webapp/frontend/src/studio/__tests__/useStudioEngine.test.ts`:

```ts
  it("initializes region to the full track", async () => {
    const { result } = renderHook(() => useStudioEngine(job));
    await waitFor(() => expect(result.current.transport.duration).toBe(10));
    expect(result.current.region).toEqual({ start: 0, end: 10 });
  });

  it("clamps setRegion to valid bounds with a 0.1s minimum gap", async () => {
    const { result } = renderHook(() => useStudioEngine(job));
    await waitFor(() => expect(result.current.transport.duration).toBe(10));
    act(() => result.current.setRegion(-5, 99));
    expect(result.current.region).toEqual({ start: 0, end: 10 });
    act(() => result.current.setRegion(4, 4));
    expect(result.current.region.start).toBe(4);
    expect(result.current.region.end).toBeCloseTo(4.1, 5);
  });

  it("includes start/end_sec in the mixdown request only when narrowed", async () => {
    const { result } = renderHook(() => useStudioEngine(job));
    await waitFor(() => expect(result.current.stems.length).toBe(2));
    let req = result.current.buildMixdownRequest("mp3", "clip");
    expect(req.start_sec).toBeUndefined();
    expect(req.end_sec).toBeUndefined();
    act(() => result.current.setRegion(2, 8));
    req = result.current.buildMixdownRequest("mp3", "clip");
    expect(req.start_sec).toBe(2);
    expect(req.end_sec).toBe(8);
    act(() => result.current.resetRegion());
    req = result.current.buildMixdownRequest("mp3", "clip");
    expect(req.start_sec).toBeUndefined();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/studio/__tests__/useStudioEngine.test.ts`
Expected: 3 new tests FAIL (`region` is undefined / `setRegion` is not a function). Existing test PASSES.

- [ ] **Step 3: Implement region state**

In `webapp/frontend/src/types.ts`, add to `MixdownRequest`:

```ts
export interface MixdownRequest {
  name: string;
  format: OutputFormat;
  bitrate?: number;
  bitdepth?: number;
  start_sec?: number;
  end_sec?: number;
  tracks: MixdownTrack[];
}
```

In `webapp/frontend/src/studio/useStudioEngine.ts`:

Add below the `Channel` interface:

```ts
export interface Region {
  start: number;
  end: number;
}

const MIN_REGION_GAP = 0.1; // seconds
const REGION_EDGE_EPS = 0.05; // region within this of the edges counts as "full track"
```

Add state next to the other `useState` calls:

```ts
  const [region, setRegionState] = useState<Region>({ start: 0, end: 0 });
```

In the `engine.load(tracks).then(...)` callback, after `setTransport(...)`, add:

```ts
      setRegionState({ start: 0, end: engine.duration });
```

In the returned object, add (and update `buildMixdownRequest`):

```ts
    region,
    setRegion: (start: number, end: number) => {
      const d = engineRef.current?.duration ?? 0;
      if (d <= 0) return;
      const s = Math.min(Math.max(0, start), Math.max(0, d - MIN_REGION_GAP));
      const e = Math.min(Math.max(end, s + MIN_REGION_GAP), d);
      setRegionState({ start: s, end: e });
    },
    resetRegion: () => setRegionState({ start: 0, end: engineRef.current?.duration ?? 0 }),
    playSelection: () => engineRef.current?.playSelection(region.start, region.end),
    buildMixdownRequest: (format: "wav" | "flac" | "mp3", name: string): MixdownRequest => {
      const d = engineRef.current?.duration ?? 0;
      const narrowed = d > 0 && (region.start > REGION_EDGE_EPS || region.end < d - REGION_EDGE_EPS);
      return {
        name, format,
        bitrate: format === "mp3" ? 320 : undefined,
        bitdepth: format === "wav" ? 16 : undefined,
        ...(narrowed ? { start_sec: region.start, end_sec: region.end } : {}),
        tracks: channels.map((c) => ({ stem: c.stem, gain: c.volume, muted: c.muted })),
      };
    },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/studio/__tests__/useStudioEngine.test.ts`
Expected: all 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add webapp/frontend/src/types.ts webapp/frontend/src/studio/useStudioEngine.ts webapp/frontend/src/studio/__tests__/useStudioEngine.test.ts
git commit -m "feat(studio): region state with clamping and ranged mixdown requests"
```

---

### Task 5: Frontend — shared time formatter + RegionTimeline component

**Files:**
- Create: `webapp/frontend/src/studio/time.ts`
- Create: `webapp/frontend/src/studio/RegionTimeline.tsx`
- Test: `webapp/frontend/src/studio/__tests__/RegionTimeline.test.tsx`

**Interfaces:**
- Produces: `fmtTime(t: number): string` (e.g. `83.2 → "1:23"`), and `RegionTimeline` with props `{ duration: number; currentTime: number; region: { start: number; end: number }; onRegionChange: (start: number, end: number) => void; onSeek: (t: number) => void }`. The component passes **raw** values to `onRegionChange` — clamping is the hook's job (Task 4). Task 6 wires it into `Studio.tsx`.

- [ ] **Step 1: Write the failing tests**

Create `webapp/frontend/src/studio/__tests__/RegionTimeline.test.tsx`:

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { RegionTimeline } from "../RegionTimeline";

// jsdom has no PointerEvent; polyfill so fireEvent.pointer* carries clientX
if (typeof window !== "undefined" && !("PointerEvent" in window)) {
  class FakePointerEvent extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: any = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
    }
  }
  vi.stubGlobal("PointerEvent", FakePointerEvent as any);
}

const rect = {
  left: 0, top: 0, width: 100, height: 28, right: 100, bottom: 28, x: 0, y: 0,
  toJSON: () => ({}),
} as DOMRect;

function setup(region = { start: 10, end: 60 }) {
  const onRegionChange = vi.fn();
  const onSeek = vi.fn();
  render(
    <RegionTimeline duration={100} currentTime={5} region={region}
      onRegionChange={onRegionChange} onSeek={onSeek} />,
  );
  const track = screen.getByTestId("region-track");
  vi.spyOn(track, "getBoundingClientRect").mockReturnValue(rect);
  return { onRegionChange, onSeek, track };
}

describe("RegionTimeline", () => {
  it("shows region times and resets to full width", () => {
    const { onRegionChange } = setup();
    expect(screen.getByText(/0:10 – 1:00 \(0:50\)/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /reset region/i }));
    expect(onRegionChange).toHaveBeenCalledWith(0, 100);
  });

  it("drags the start handle and stops reporting after pointer up", () => {
    const { onRegionChange } = setup();
    const handle = screen.getByRole("slider", { name: /region start/i });
    fireEvent.pointerDown(handle, { clientX: 10, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 25, pointerId: 1 });
    expect(onRegionChange).toHaveBeenLastCalledWith(25, 60);
    fireEvent.pointerUp(handle, { pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 40, pointerId: 1 });
    expect(onRegionChange).toHaveBeenCalledTimes(1);
  });

  it("drags the end handle", () => {
    const { onRegionChange } = setup();
    const handle = screen.getByRole("slider", { name: /region end/i });
    fireEvent.pointerDown(handle, { clientX: 60, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 80, pointerId: 1 });
    expect(onRegionChange).toHaveBeenLastCalledWith(10, 80);
  });

  it("nudges handles with arrow keys (shift = 1s)", () => {
    const { onRegionChange } = setup();
    const start = screen.getByRole("slider", { name: /region start/i });
    fireEvent.keyDown(start, { key: "ArrowRight" });
    expect(onRegionChange).toHaveBeenCalledWith(10.1, 60);
    fireEvent.keyDown(start, { key: "ArrowLeft", shiftKey: true });
    expect(onRegionChange).toHaveBeenCalledWith(9, 60);
  });

  it("seeks when the ruler background is clicked", () => {
    const { onSeek, track } = setup();
    fireEvent.pointerDown(track, { clientX: 40, pointerId: 1 });
    expect(onSeek).toHaveBeenCalledWith(40);
  });

  it("does not seek when a handle is grabbed", () => {
    const { onSeek } = setup();
    const handle = screen.getByRole("slider", { name: /region start/i });
    fireEvent.pointerDown(handle, { clientX: 10, pointerId: 1 });
    expect(onSeek).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/studio/__tests__/RegionTimeline.test.tsx`
Expected: FAIL — cannot resolve `../RegionTimeline`.

- [ ] **Step 3: Implement `time.ts` and `RegionTimeline.tsx`**

Create `webapp/frontend/src/studio/time.ts`:

```ts
export function fmtTime(t: number): string {
  const s = Math.floor(t % 60).toString().padStart(2, "0");
  const m = Math.floor(t / 60).toString();
  return `${m}:${s}`;
}
```

Create `webapp/frontend/src/studio/RegionTimeline.tsx`:

```tsx
import React, { useRef } from "react";
import { fmtTime } from "./time";

export interface RegionTimelineProps {
  duration: number;
  currentTime: number;
  region: { start: number; end: number };
  onRegionChange: (start: number, end: number) => void;
  onSeek: (t: number) => void;
}

export function RegionTimeline(p: RegionTimelineProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<"start" | "end" | null>(null);

  const pct = (t: number) =>
    p.duration > 0 ? Math.min(100, Math.max(0, (t / p.duration) * 100)) : 0;

  const timeFromClientX = (clientX: number): number => {
    const el = trackRef.current;
    if (!el || p.duration <= 0) return 0;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return 0;
    const x = Math.min(Math.max(clientX - rect.left, 0), rect.width);
    return (x / rect.width) * p.duration;
  };

  const moveHandle = (which: "start" | "end", t: number) => {
    if (which === "start") p.onRegionChange(t, p.region.end);
    else p.onRegionChange(p.region.start, t);
  };

  const handleProps = (which: "start" | "end") => ({
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
      e.stopPropagation();
      dragging.current = which;
      e.currentTarget.setPointerCapture?.(e.pointerId);
    },
    onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => {
      if (dragging.current !== which) return;
      moveHandle(which, timeFromClientX(e.clientX));
    },
    onPointerUp: () => {
      dragging.current = null;
    },
    onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => {
      const step = e.shiftKey ? 1 : 0.1;
      const delta = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
      if (!delta) return;
      e.preventDefault();
      moveHandle(which, (which === "start" ? p.region.start : p.region.end) + delta);
    },
  });

  return (
    <div className="region-timeline">
      <div className="region-info">
        <span className="region-times">
          {fmtTime(p.region.start)} – {fmtTime(p.region.end)} ({fmtTime(p.region.end - p.region.start)})
        </span>
        <button aria-label="reset region" onClick={() => p.onRegionChange(0, p.duration)}>
          Reset
        </button>
      </div>
      <div
        className="region-track"
        data-testid="region-track"
        ref={trackRef}
        onPointerDown={(e) => p.onSeek(timeFromClientX(e.clientX))}
      >
        <div
          className="region-shade"
          style={{ left: `${pct(p.region.start)}%`, width: `${pct(p.region.end) - pct(p.region.start)}%` }}
        />
        <div
          role="slider"
          tabIndex={0}
          aria-label="region start"
          aria-valuemin={0}
          aria-valuemax={p.duration}
          aria-valuenow={p.region.start}
          className="region-handle start"
          style={{ left: `${pct(p.region.start)}%` }}
          {...handleProps("start")}
        />
        <div
          role="slider"
          tabIndex={0}
          aria-label="region end"
          aria-valuemin={0}
          aria-valuemax={p.duration}
          aria-valuenow={p.region.end}
          className="region-handle end"
          style={{ left: `${pct(p.region.end)}%` }}
          {...handleProps("end")}
        />
        <div className="region-playhead" style={{ left: `${pct(p.currentTime)}%` }} />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/studio/__tests__/RegionTimeline.test.tsx`
Expected: all 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add webapp/frontend/src/studio/time.ts webapp/frontend/src/studio/RegionTimeline.tsx webapp/frontend/src/studio/__tests__/RegionTimeline.test.tsx
git commit -m "feat(studio): RegionTimeline ruler with draggable start/end markers"
```

---

### Task 6: Frontend — Studio integration, transport button, export summary, CSS

**Files:**
- Modify: `webapp/frontend/src/studio/Transport.tsx`
- Modify: `webapp/frontend/src/studio/ExportPanel.tsx`
- Modify: `webapp/frontend/src/screens/Studio.tsx`
- Modify: `webapp/frontend/src/styles.css`
- Test: `webapp/frontend/src/studio/__tests__/Controls.test.tsx`, `webapp/frontend/src/studio/__tests__/ab_export.test.tsx`

**Interfaces:**
- Consumes: `RegionTimeline` + `fmtTime` (Task 5); `region`, `setRegion`, `playSelection`, `seek`, `transport` from the hook (Task 4).
- Produces: `TransportProps` gains required `onPlaySelection: () => void`; `ExportPanel` gains optional `rangeSummary?: string`.

- [ ] **Step 1: Write the failing component tests**

In `webapp/frontend/src/studio/__tests__/Controls.test.tsx`, replace the `describe("Transport", ...)` block (the old `/play/i` matcher becomes ambiguous once a "play selection" button exists, so it changes to `/^play$/i`):

```tsx
describe("Transport", () => {
  it("toggles play and reports seek", () => {
    const onPlayPause = vi.fn(), onSeek = vi.fn();
    render(
      <Transport playing={false} currentTime={5} duration={60}
        onPlayPause={onPlayPause} onStop={vi.fn()} onSeek={onSeek}
        onPlaySelection={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^play$/i }));
    fireEvent.change(screen.getByLabelText(/seek/i), { target: { value: "12" } });
    expect(onPlayPause).toHaveBeenCalled();
    expect(onSeek).toHaveBeenCalledWith(12);
  });

  it("plays the selection via its own button", () => {
    const onPlaySelection = vi.fn();
    render(
      <Transport playing={false} currentTime={0} duration={60}
        onPlayPause={vi.fn()} onStop={vi.fn()} onSeek={vi.fn()}
        onPlaySelection={onPlaySelection} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /play selection/i }));
    expect(onPlaySelection).toHaveBeenCalled();
  });

  it("disables play selection while stems are loading", () => {
    render(
      <Transport playing={false} currentTime={0} duration={0}
        onPlayPause={vi.fn()} onStop={vi.fn()} onSeek={vi.fn()}
        onPlaySelection={vi.fn()} />,
    );
    const btn = screen.getByRole("button", { name: /play selection/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});
```

In `webapp/frontend/src/studio/__tests__/ab_export.test.tsx`, append inside `describe("ExportPanel", ...)`:

```tsx
  it("shows the export range summary when provided", () => {
    render(<ExportPanel onExport={vi.fn()} rangeSummary="Selection 0:02 – 0:08 (0:06)" />);
    expect(screen.getByText("Selection 0:02 – 0:08 (0:06)")).toBeTruthy();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/studio/__tests__/Controls.test.tsx src/studio/__tests__/ab_export.test.tsx`
Expected: FAIL — no "play selection" button; no range-summary text. (TypeScript may also flag the unknown props; that's part of the failure.)

- [ ] **Step 3: Implement Transport and ExportPanel changes**

Replace `webapp/frontend/src/studio/Transport.tsx` with:

```tsx
import React from "react";
import { fmtTime } from "./time";

export interface TransportProps {
  playing: boolean;
  currentTime: number;
  duration: number;
  onPlayPause: () => void;
  onStop: () => void;
  onSeek: (t: number) => void;
  onPlaySelection: () => void;
}

export function Transport(p: TransportProps) {
  return (
    <div className="transport">
      <button aria-label={p.playing ? "pause" : "play"} onClick={p.onPlayPause}>
        {p.playing ? "⏸" : "▶"}
      </button>
      <button aria-label="stop" onClick={p.onStop}>⏹</button>
      <button
        aria-label="play selection" title="Play selection"
        disabled={p.duration <= 0} onClick={p.onPlaySelection}
      >
        ▶|
      </button>
      <span className="time">{fmtTime(p.currentTime)} / {fmtTime(p.duration)}</span>
      <input
        type="range" min={0} max={p.duration || 0} step={0.1} value={p.currentTime}
        aria-label="seek"
        onChange={(e) => p.onSeek(Number(e.target.value))}
      />
    </div>
  );
}
```

(The local `fmt` helper is deleted in favor of the shared `fmtTime`.)

Replace `webapp/frontend/src/studio/ExportPanel.tsx` with:

```tsx
import React, { useState } from "react";
import type { OutputFormat } from "../types";

export function ExportPanel({ onExport, rangeSummary }: {
  onExport: (format: OutputFormat, name: string) => void;
  rangeSummary?: string;
}) {
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
      {rangeSummary ? <span className="export-range">{rangeSummary}</span> : null}
      <button onClick={() => onExport(format, name)}>Export mixdown</button>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/studio/__tests__/Controls.test.tsx src/studio/__tests__/ab_export.test.tsx`
Expected: all PASS.

- [ ] **Step 5: Wire everything into Studio.tsx**

Replace `webapp/frontend/src/screens/Studio.tsx` with:

```tsx
import React from "react";
import type { Job } from "../types";
import { useStudioEngine } from "../studio/useStudioEngine";
import { ChannelStrip } from "../studio/ChannelStrip";
import { Transport } from "../studio/Transport";
import { Waveform } from "../studio/Waveform";
import { ABToggle } from "../studio/ABToggle";
import { ExportPanel } from "../studio/ExportPanel";
import { RegionTimeline } from "../studio/RegionTimeline";
import { fmtTime } from "../studio/time";
import { stemUrl, createMixdown, mixdownDownloadUrl } from "../api/client";

export function Studio({ job, onBack }: { job: Job; onBack: () => void }) {
  const s = useStudioEngine(job);
  const dur = s.transport.duration;
  const pct = (t: number) => (dur > 0 ? Math.min(100, Math.max(0, (t / dur) * 100)) : 0);
  const narrowed = dur > 0 && (s.region.start > 0.05 || s.region.end < dur - 0.05);
  const rangeSummary = narrowed
    ? `Selection ${fmtTime(s.region.start)} – ${fmtTime(s.region.end)} (${fmtTime(s.region.end - s.region.start)})`
    : "Full track";

  async function handleExport(format: "wav" | "flac" | "mp3", name: string) {
    const req = s.buildMixdownRequest(format, name);
    const out = await createMixdown(job.id, req);
    window.location.href = mixdownDownloadUrl(out.id);
  }

  return (
    <div className="studio">
      <header>
        <button onClick={onBack}>◀ Back</button>
        <strong>{job.source_filename}</strong>
        <span>{job.model} · {job.device_used ?? ""}</span>
        <ABToggle mode={s.abMode} onMode={s.setABMode} />
      </header>
      <RegionTimeline
        duration={dur}
        currentTime={s.transport.currentTime}
        region={s.region}
        onRegionChange={s.setRegion}
        onSeek={s.seek}
      />
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
        <div className="tracks-overlay" aria-hidden="true">
          <div className="overlay-dim" style={{ left: 0, width: `${pct(s.region.start)}%` }} />
          <div className="overlay-dim" style={{ left: `${pct(s.region.end)}%`, right: 0 }} />
          <div className="overlay-playhead" style={{ left: `${pct(s.transport.currentTime)}%` }} />
        </div>
      </div>
      <Transport
        playing={s.transport.playing}
        currentTime={s.transport.currentTime}
        duration={s.transport.duration}
        onPlayPause={() => (s.transport.playing ? s.pause() : s.play())}
        onStop={s.stop}
        onSeek={s.seek}
        onPlaySelection={s.playSelection}
      />
      <label className="master">
        Master
        <input type="range" min={0} max={1.5} step={0.01} value={s.master}
          onChange={(e) => s.setMaster(Number(e.target.value))} />
      </label>
      <ExportPanel onExport={handleExport} rangeSummary={rangeSummary} />
    </div>
  );
}
```

- [ ] **Step 6: Add the CSS**

In `webapp/frontend/src/styles.css`:

a) Inside the `:root` block (after `--radius-lg: 10px;`), add:

```css
  /* Layout */
  --track-gutter: 160px;
```

b) In `.track-row` (~line 716), change `grid-template-columns: 160px 1fr;` to:

```css
  grid-template-columns: var(--track-gutter) 1fr;
```

c) In `.tracks` (~line 708), add one line:

```css
  position: relative;
```

d) In the `@media (max-width: 600px)` block, replace the `.track-row { grid-template-columns: 120px 1fr; }` rule with:

```css
  :root {
    --track-gutter: 120px;
  }
```

e) After the `/* ── Tracks Area ── */` section's `.track-row:last-child` rule, add:

```css
/* ── Region Timeline ──────────────────────────────────────── */
.region-timeline {
  display: grid;
  grid-template-columns: var(--track-gutter) 1fr;
  align-items: center;
  background: var(--surface);
  border-bottom: 1px solid var(--border-subtle);
}

.region-info {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-2);
  padding: var(--sp-2) var(--sp-4);
  border-right: 1px solid var(--border-subtle);
}

.region-times {
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  color: var(--text-dim);
  white-space: nowrap;
}

.region-info button {
  min-height: 20px;
  padding: 2px 8px;
  font-size: 0.625rem;
  background: var(--surface-raise);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text-muted);
}

.region-info button:hover {
  color: var(--text);
  border-color: var(--accent-dim);
}

.region-track {
  position: relative;
  height: 32px;
  margin: 0 var(--sp-4);
  cursor: pointer;
}

.region-track::before {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  top: 50%;
  height: 2px;
  margin-top: -1px;
  background: var(--border-subtle);
  border-radius: 1px;
}

.region-shade {
  position: absolute;
  top: 4px;
  bottom: 4px;
  background: var(--accent-glow);
  border: 1px solid var(--accent-dim);
  border-radius: var(--radius-sm);
  pointer-events: none;
}

.region-handle {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 12px;
  margin-left: -6px;
  cursor: ew-resize;
  touch-action: none;
}

.region-handle::after {
  content: "";
  position: absolute;
  left: 50%;
  top: 2px;
  bottom: 2px;
  width: 3px;
  margin-left: -1.5px;
  background: var(--accent);
  border-radius: 2px;
}

.region-handle:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.region-playhead {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--text);
  opacity: 0.8;
  pointer-events: none;
}

/* ── Region overlay across waveforms ──────────────────────── */
.tracks-overlay {
  position: absolute;
  top: 0;
  bottom: 0;
  left: calc(var(--track-gutter) + var(--sp-4));
  right: var(--sp-4);
  pointer-events: none;
}

.overlay-dim {
  position: absolute;
  top: 0;
  bottom: 0;
  background: rgba(10, 11, 18, 0.55);
}

.overlay-playhead {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--text);
  opacity: 0.55;
}
```

f) In the `.export-panel` section (~line 880), add:

```css
.export-range {
  font-family: var(--font-mono);
  font-size: 0.75rem;
  color: var(--text-dim);
  white-space: nowrap;
}
```

- [ ] **Step 7: Run the whole frontend suite and typecheck**

Run: `npx vitest run` then `npx tsc -b`
Expected: all tests PASS; no type errors.

- [ ] **Step 8: Commit**

```bash
git add webapp/frontend/src/studio/Transport.tsx webapp/frontend/src/studio/ExportPanel.tsx webapp/frontend/src/screens/Studio.tsx webapp/frontend/src/styles.css webapp/frontend/src/studio/__tests__/Controls.test.tsx webapp/frontend/src/studio/__tests__/ab_export.test.tsx
git commit -m "feat(studio): region ruler, waveform region overlay, play-selection, ranged export"
```

Note: `styles.css` has unrelated uncommitted changes in the working tree. If `git diff styles.css` shows hunks beyond this task's additions, stage selectively (`git add -p webapp/frontend/src/styles.css`) so only the region-timeline hunks are committed.

---

### Task 7: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Backend suite**

Run (from `webapp/backend/`): `.venv\Scripts\python -m pytest -q`
Expected: all PASS.

- [ ] **Step 2: Frontend suite + build**

Run (from `webapp/frontend/`): `npx vitest run` then `npm run build`
Expected: all tests PASS; build succeeds.

- [ ] **Step 3: Manual end-to-end check (superpowers:verification-before-completion)**

1. Start the app (`webapp/scripts/run-dev.ps1`) and open a finished job in Studio.
2. Drag the start and end markers — the ruler shade and the dimmed areas over the waveforms track them; times update in the ruler's left cell.
3. Click "▶|" — playback jumps to the start marker and stops at the end marker.
4. Confirm the ExportPanel shows `Selection m:ss – m:ss (m:ss)`; export a short WAV clip and verify its duration equals the selection length.
5. Click Reset — summary returns to "Full track"; export renders the whole song.

- [ ] **Step 4: Update the checkboxes in this plan and report results**
