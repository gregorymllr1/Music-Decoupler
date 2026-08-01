# Studio Timeline Zoom Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user zoom the Studio timeline in and out so export-region start/end markers can be placed to the millisecond instead of the current ~0.27 s/pixel floor.

**Architecture:** A single `view = { start, end }` (seconds) becomes the horizontal mapping for every element in the Studio — ruler, stem waveforms, dim overlay, playhead. Stem waveforms move from wavesurfer.js to a canvas renderer fed by the `AudioBuffer`s `StudioEngine` already decodes, so every element shares one `[view.start, view.end] → [0, width]` mapping and alignment is correct by construction with no scroll to synchronise. Zoom never mutates `region`, playback, or the export request.

**Tech Stack:** React 18 + TypeScript, Vite, Vitest + @testing-library/react (jsdom, `globals: true`, no setup files), Web Audio API, HTML canvas 2D.

**Spec:** `docs/superpowers/specs/2026-08-01-studio-timeline-zoom-design.md`

## Global Constants

Copy these values verbatim. They are referenced by many tasks.

| Name            | Value  | Defined in            | Meaning                                        |
| --------------- | ------ | --------------------- | ---------------------------------------------- |
| `MIN_VIEW_SPAN` | `0.25` | `useTimelineView.ts`  | seconds; tightest zoom                         |
| `ZOOM_STEP`     | `2`    | `useTimelineView.ts`  | factor per `[+]`/`[−]` click or wheel notch    |
| `PAN_STEP`      | `0.15` | `useTimelineView.ts`  | fraction of a span per `Shift`+wheel notch     |
| `SELECTION_PAD` | `0.05` | `useTimelineView.ts`  | fraction of region length padded on each side  |
| `PEAK_BUCKET`   | `256`  | `peaks.ts`            | samples per peak-pyramid bucket                |

## Global Constraints

- **Working directory for all commands is `webapp/frontend`.** Tests run with `npm test` (`vitest run`); a single file runs with `npx vitest run src/studio/__tests__/<file>`.
- **Never break the full-track case.** At `view = { start: 0, end: duration }` every mapping, nudge step, and readout must be byte-identical to current behaviour. This is the plan's safety net and is guarded by the existing `RegionTimeline` tests.
- **jsdom gaps to code around, not to fight:** there is no `AudioBuffer`, no `ResizeObserver`, no canvas 2D context, and no `PointerEvent` (the existing `RegionTimeline.test.tsx` polyfills the last one — reuse that pattern). Components must guard `getContext("2d")` returning `null` and a missing `ResizeObserver` constructor. These guards are harmless in production.
- **Do not compile TypeScript into `src/`.** `tsc` is configured `noEmit`; stale `.js` next to a `.tsx` silently shadows the source. Never run `tsc` without `-b`/`--noEmit`.
- **Colour comes from the `--accent` CSS custom property** (already `#7aa2f7`, the value `Waveform.tsx` hardcodes today), with `#7aa2f7` as the literal fallback.
- **Existing spacing must not change:** `.waveform` keeps `padding: var(--sp-3) var(--sp-4)` (12px/16px) and `.region-track` keeps `margin: 0 var(--sp-4)`. Those two 16px insets are what make the ruler and the waveforms line up.
- Commit after every task. Branch is `feature/studio-timeline-zoom`.

---

### Task 1: Time formatting precision

**Files:**
- Modify: `src/studio/time.ts`
- Test: `src/studio/__tests__/time.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `fmtTime(t: number, decimals?: number): string` — `decimals` defaults to `0` and that path is byte-identical to today's output. `decimalsForSpan(span: number): number` returning `0 | 1 | 2 | 3`.

- [ ] **Step 1: Write the failing test**

Create `src/studio/__tests__/time.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { fmtTime, decimalsForSpan } from "../time";

describe("fmtTime", () => {
  it("keeps the existing whole-second format by default", () => {
    expect(fmtTime(10)).toBe("0:10");
    expect(fmtTime(60)).toBe("1:00");
    expect(fmtTime(50)).toBe("0:50");
    expect(fmtTime(9.9)).toBe("0:09");
  });

  it("renders fractional seconds when asked", () => {
    expect(fmtTime(43.1837, 3)).toBe("0:43.184");
    expect(fmtTime(43.18, 2)).toBe("0:43.18");
    expect(fmtTime(3.2, 2)).toBe("0:03.20");
    expect(fmtTime(0.5, 3)).toBe("0:00.500");
  });

  it("carries the minute when rounding reaches 60 seconds", () => {
    expect(fmtTime(59.96, 1)).toBe("1:00.0");
    expect(fmtTime(119.999, 2)).toBe("2:00.00");
  });

  it("clamps negative input to zero", () => {
    expect(fmtTime(-5)).toBe("0:00");
    expect(fmtTime(-5, 2)).toBe("0:00.00");
  });
});

describe("decimalsForSpan", () => {
  it("picks precision from the visible span, first match wins", () => {
    expect(decimalsForSpan(232)).toBe(0);
    expect(decimalsForSpan(60.1)).toBe(0);
    expect(decimalsForSpan(60)).toBe(1);
    expect(decimalsForSpan(10.5)).toBe(1);
    expect(decimalsForSpan(10)).toBe(2);
    expect(decimalsForSpan(1.5)).toBe(2);
    expect(decimalsForSpan(1)).toBe(3);
    expect(decimalsForSpan(0.25)).toBe(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/studio/__tests__/time.test.ts`
Expected: FAIL — `decimalsForSpan` is not exported, and the fractional cases return `0:43`.

- [ ] **Step 3: Write the implementation**

Replace the whole of `src/studio/time.ts`:

```ts
export function fmtTime(t: number, decimals = 0): string {
  const clamped = t > 0 ? t : 0;
  if (decimals <= 0) {
    const s = Math.floor(clamped % 60).toString().padStart(2, "0");
    const m = Math.floor(clamped / 60).toString();
    return `${m}:${s}`;
  }
  // Round first, then split, so 59.96s at 1dp is "1:00.0" and never "0:60.0".
  const p = Math.pow(10, decimals);
  const total = Math.round(clamped * p) / p;
  const m = Math.floor(total / 60);
  const s = total - m * 60;
  return `${m}:${s.toFixed(decimals).padStart(decimals + 3, "0")}`;
}

export function decimalsForSpan(span: number): number {
  if (span > 60) return 0;
  if (span > 10) return 1;
  if (span > 1) return 2;
  return 3;
}
```

- [ ] **Step 4: Run the new test and the full suite**

Run: `npx vitest run src/studio/__tests__/time.test.ts`
Expected: PASS

Run: `npm test`
Expected: PASS — the `decimals === 0` path is unchanged, so `Transport` and `RegionTimeline` output is identical.

- [ ] **Step 5: Commit**

```bash
git add src/studio/time.ts src/studio/__tests__/time.test.ts
git commit -m "feat(studio): add optional sub-second precision to fmtTime"
```

---

### Task 2: Peak computation

**Files:**
- Create: `src/studio/peaks.ts`
- Test: `src/studio/__tests__/peaks.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `PEAK_BUCKET = 256`
  - `interface AudioSourceLike { numberOfChannels: number; length: number; sampleRate: number; getChannelData(channel: number): Float32Array }`
  - `interface PeakPyramid { min: Float32Array; max: Float32Array; bucketSize: number; sampleRate: number; length: number }`
  - `interface WaveformData { source: AudioSourceLike; pyramid: PeakPyramid }`
  - `interface Columns { min: Float32Array; max: Float32Array }`
  - `buildPeakPyramid(source: AudioSourceLike, bucketSize?: number): PeakPyramid`
  - `computeColumns(source: AudioSourceLike, pyramid: PeakPyramid, viewStart: number, viewEnd: number, width: number): Columns`

Typed against `AudioSourceLike` rather than `AudioBuffer` specifically so tests can pass a plain object — jsdom has no `AudioBuffer`.

- [ ] **Step 1: Write the failing test**

Create `src/studio/__tests__/peaks.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  buildPeakPyramid, computeColumns, PEAK_BUCKET, type AudioSourceLike,
} from "../peaks";

/** Mono source of `length` samples at 1000 Hz, filled by `fn`. */
function src(length: number, fn: (i: number) => number, channels = 1): AudioSourceLike {
  const data: Float32Array[] = [];
  for (let c = 0; c < channels; c++) {
    const arr = new Float32Array(length);
    for (let i = 0; i < length; i++) arr[i] = fn(i);
    data.push(arr);
  }
  return {
    numberOfChannels: channels,
    length,
    sampleRate: 1000,
    getChannelData: (c: number) => data[c],
  };
}

describe("buildPeakPyramid", () => {
  it("records the min and max of every bucket", () => {
    // Sawtooth: +1 on even samples, -0.5 on odd ones.
    const s = src(1024, (i) => (i % 2 === 0 ? 1 : -0.5));
    const p = buildPeakPyramid(s);
    expect(p.bucketSize).toBe(PEAK_BUCKET);
    expect(p.length).toBe(1024);
    expect(p.min.length).toBe(4);
    expect(p.max.length).toBe(4);
    for (let b = 0; b < 4; b++) {
      expect(p.max[b]).toBeCloseTo(1, 5);
      expect(p.min[b]).toBeCloseTo(-0.5, 5);
    }
  });

  it("averages channels to mono", () => {
    const s = src(256, () => 1, 2);
    // Both channels are 1.0, so the mono average is 1.0 (not 2.0).
    expect(buildPeakPyramid(s).max[0]).toBeCloseTo(1, 5);
  });

  it("covers a trailing partial bucket", () => {
    const s = src(300, (i) => (i >= 256 ? 0.75 : 0));
    const p = buildPeakPyramid(s);
    expect(p.min.length).toBe(2);
    expect(p.max[1]).toBeCloseTo(0.75, 5);
  });

  it("returns an empty pyramid for an empty source", () => {
    const p = buildPeakPyramid(src(0, () => 0));
    expect(p.min.length).toBe(0);
    expect(p.length).toBe(0);
  });
});

describe("computeColumns", () => {
  const s = src(10_000, (i) => Math.sin((i / 50) * Math.PI));
  const p = buildPeakPyramid(s);

  it("returns exactly `width` columns", () => {
    const c = computeColumns(s, p, 0, 10, 128);
    expect(c.min.length).toBe(128);
    expect(c.max.length).toBe(128);
  });

  it("returns empty arrays for degenerate inputs", () => {
    expect(computeColumns(s, p, 0, 10, 0).min.length).toBe(0);
    expect(computeColumns(s, p, 5, 5, 64).min.length).toBe(64);
    expect(computeColumns(s, p, 5, 5, 64).max.every((v) => v === 0)).toBe(true);
  });

  it("uses the raw tier when zoomed past one bucket per pixel", () => {
    // 0.05s at 1000Hz over 100px = 0.5 samples/px, far below PEAK_BUCKET.
    const c = computeColumns(s, p, 1, 1.05, 100);
    expect(c.min.length).toBe(100);
    expect(c.max.some((v) => v !== 0)).toBe(true);
  });

  it("pyramid tier envelopes the raw tier over the same window", () => {
    // Zoomed out: pyramid tier. Bucket-aligned scanning may widen the
    // envelope, so it must contain the exact raw envelope, not equal it.
    const wide = computeColumns(s, p, 0, 10, 50);
    const exact = computeColumns(s, { ...p, bucketSize: 1e9 }, 0, 10, 50);
    for (let i = 0; i < 50; i++) {
      expect(wide.min[i]).toBeLessThanOrEqual(exact.min[i] + 1e-6);
      expect(wide.max[i]).toBeGreaterThanOrEqual(exact.max[i] - 1e-6);
    }
  });

  it("yields silence for columns past the end of a short stem", () => {
    const short = src(1000, () => 1); // 1 second of audio
    const sp = buildPeakPyramid(short);
    const c = computeColumns(short, sp, 0, 4, 40); // 4-second view
    expect(c.max[5]).toBeCloseTo(1, 5);   // inside the audio
    expect(c.max[35]).toBe(0);            // past its end
    expect(c.min[35]).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/studio/__tests__/peaks.test.ts`
Expected: FAIL — cannot resolve `../peaks`.

- [ ] **Step 3: Write the implementation**

Create `src/studio/peaks.ts`:

```ts
export const PEAK_BUCKET = 256;

/** Structural subset of AudioBuffer — jsdom has no AudioBuffer to test against. */
export interface AudioSourceLike {
  numberOfChannels: number;
  length: number;
  sampleRate: number;
  getChannelData(channel: number): Float32Array;
}

export interface PeakPyramid {
  min: Float32Array; // one entry per bucket
  max: Float32Array;
  bucketSize: number;
  sampleRate: number;
  length: number; // source sample count
}

/** Everything a Waveform needs to draw itself at any zoom level. */
export interface WaveformData {
  source: AudioSourceLike;
  pyramid: PeakPyramid;
}

export interface Columns {
  min: Float32Array;
  max: Float32Array;
}

export function buildPeakPyramid(
  source: AudioSourceLike,
  bucketSize = PEAK_BUCKET,
): PeakPyramid {
  const { length, sampleRate, numberOfChannels } = source;
  const buckets = bucketSize > 0 ? Math.ceil(length / bucketSize) : 0;
  const min = new Float32Array(buckets);
  const max = new Float32Array(buckets);
  if (buckets === 0 || numberOfChannels === 0) {
    return { min, max, bucketSize, sampleRate, length };
  }

  const channels: Float32Array[] = [];
  for (let c = 0; c < numberOfChannels; c++) channels.push(source.getChannelData(c));

  for (let b = 0; b < buckets; b++) {
    const s0 = b * bucketSize;
    const s1 = Math.min(s0 + bucketSize, length);
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = s0; i < s1; i++) {
      let sum = 0;
      for (let c = 0; c < channels.length; c++) sum += channels[c][i];
      const v = sum / channels.length;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    min[b] = lo === Infinity ? 0 : lo;
    max[b] = hi === -Infinity ? 0 : hi;
  }
  return { min, max, bucketSize, sampleRate, length };
}

export function computeColumns(
  source: AudioSourceLike,
  pyramid: PeakPyramid,
  viewStart: number,
  viewEnd: number,
  width: number,
): Columns {
  const w = Math.max(0, Math.floor(width));
  const min = new Float32Array(w);
  const max = new Float32Array(w);
  const span = viewEnd - viewStart;
  if (w === 0 || span <= 0 || pyramid.length === 0) return { min, max };

  const sr = pyramid.sampleRate;
  // Zoomed out, one pixel spans many buckets: read the pyramid. Zoomed in,
  // a pixel spans fewer samples than a bucket, so the pyramid would look
  // stair-stepped — read raw samples instead.
  const samplesPerPixel = (span * sr) / w;
  const usePyramid = samplesPerPixel >= pyramid.bucketSize;

  const channels: Float32Array[] = [];
  if (!usePyramid) {
    for (let c = 0; c < source.numberOfChannels; c++) channels.push(source.getChannelData(c));
  }

  for (let i = 0; i < w; i++) {
    const t0 = viewStart + (span * i) / w;
    const t1 = viewStart + (span * (i + 1)) / w;
    let s0 = Math.floor(t0 * sr);
    let s1 = Math.max(s0 + 1, Math.floor(t1 * sr));
    s0 = Math.max(0, Math.min(s0, pyramid.length));
    s1 = Math.max(s0, Math.min(s1, pyramid.length));
    if (s0 >= s1) continue; // past the end of a short stem: leave 0/0

    let lo = Infinity;
    let hi = -Infinity;
    if (usePyramid) {
      const b0 = Math.floor(s0 / pyramid.bucketSize);
      const b1 = Math.min(Math.ceil(s1 / pyramid.bucketSize), pyramid.min.length);
      for (let b = b0; b < b1; b++) {
        if (pyramid.min[b] < lo) lo = pyramid.min[b];
        if (pyramid.max[b] > hi) hi = pyramid.max[b];
      }
    } else {
      for (let s = s0; s < s1; s++) {
        let sum = 0;
        for (let c = 0; c < channels.length; c++) sum += channels[c][s];
        const v = channels.length ? sum / channels.length : 0;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    min[i] = lo === Infinity ? 0 : lo;
    max[i] = hi === -Infinity ? 0 : hi;
  }
  return { min, max };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/studio/__tests__/peaks.test.ts`
Expected: PASS (all 9 cases)

- [ ] **Step 5: Commit**

```bash
git add src/studio/peaks.ts src/studio/__tests__/peaks.test.ts
git commit -m "feat(studio): add two-tier waveform peak computation"
```

---

### Task 3: Timeline view state

**Files:**
- Create: `src/studio/useTimelineView.ts`
- Test: `src/studio/__tests__/useTimelineView.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface View { start: number; end: number }`
  - `MIN_VIEW_SPAN = 0.25`, `ZOOM_STEP = 2`, `PAN_STEP = 0.15`, `SELECTION_PAD = 0.05`
  - `clampView(start: number, end: number, duration: number): View`
  - `useTimelineView(duration: number)` returning `{ view: View; setView(start, end): void; zoomBy(factor, anchorTime): void; fit(): void; panBy(fraction): void; zoomToSelection(start, end): void }`

- [ ] **Step 1: Write the failing test**

Create `src/studio/__tests__/useTimelineView.test.ts`:

```ts
import { renderHook, act } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { useTimelineView, clampView, MIN_VIEW_SPAN } from "../useTimelineView";

describe("clampView", () => {
  it("returns a zero view when the duration is unknown", () => {
    expect(clampView(0, 10, 0)).toEqual({ start: 0, end: 0 });
  });

  it("never lets the span go below MIN_VIEW_SPAN", () => {
    const v = clampView(5, 5.01, 100);
    expect(v.end - v.start).toBeCloseTo(MIN_VIEW_SPAN, 6);
  });

  it("never lets the span exceed the duration", () => {
    expect(clampView(-50, 500, 100)).toEqual({ start: 0, end: 100 });
  });

  it("never scrolls past either end", () => {
    expect(clampView(-10, -5, 100).start).toBe(0);
    const right = clampView(98, 108, 100);
    expect(right.end).toBe(100);
    expect(right.start).toBeCloseTo(90, 6);
  });

  it("collapses the minimum span for tracks shorter than it", () => {
    expect(clampView(0, 0.1, 0.1)).toEqual({ start: 0, end: 0.1 });
  });
});

describe("useTimelineView", () => {
  it("starts at the full track once the duration is known", () => {
    const { result } = renderHook(() => useTimelineView(100));
    expect(result.current.view).toEqual({ start: 0, end: 100 });
  });

  it("keeps the anchor at the same screen fraction while zooming", () => {
    const { result } = renderHook(() => useTimelineView(100));
    act(() => result.current.setView(20, 60)); // anchor 30 sits 25% in
    act(() => result.current.zoomBy(2, 30));
    const v = result.current.view;
    expect(v.end - v.start).toBeCloseTo(20, 6);
    expect((30 - v.start) / (v.end - v.start)).toBeCloseTo(0.25, 6);
  });

  it("clamps rather than overscrolling when zooming out at an edge", () => {
    const { result } = renderHook(() => useTimelineView(100));
    act(() => result.current.setView(0, 10));
    act(() => result.current.zoomBy(0.5, 0));
    expect(result.current.view).toEqual({ start: 0, end: 20 });
  });

  it("stops zooming in at MIN_VIEW_SPAN", () => {
    const { result } = renderHook(() => useTimelineView(100));
    act(() => result.current.setView(50, 50.3));
    act(() => result.current.zoomBy(100, 50.1));
    expect(result.current.view.end - result.current.view.start).toBeCloseTo(MIN_VIEW_SPAN, 6);
  });

  it("frames the selection with 5% padding", () => {
    const { result } = renderHook(() => useTimelineView(100));
    act(() => result.current.zoomToSelection(40, 50));
    expect(result.current.view.start).toBeCloseTo(39.5, 6);
    expect(result.current.view.end).toBeCloseTo(50.5, 6);
  });

  it("centres a MIN_VIEW_SPAN window on a selection shorter than it", () => {
    const { result } = renderHook(() => useTimelineView(100));
    act(() => result.current.zoomToSelection(50, 50.05));
    const v = result.current.view;
    expect(v.end - v.start).toBeCloseTo(MIN_VIEW_SPAN, 6);
    expect((v.start + v.end) / 2).toBeCloseTo(50.025, 6);
  });

  it("pans by a fraction of the span and clamps at the ends", () => {
    const { result } = renderHook(() => useTimelineView(100));
    act(() => result.current.setView(20, 30));
    act(() => result.current.panBy(0.15));
    expect(result.current.view).toEqual({ start: 21.5, end: 31.5 });
    act(() => result.current.panBy(-100));
    expect(result.current.view).toEqual({ start: 0, end: 10 });
  });

  it("fit restores the whole track", () => {
    const { result } = renderHook(() => useTimelineView(100));
    act(() => result.current.setView(20, 30));
    act(() => result.current.fit());
    expect(result.current.view).toEqual({ start: 0, end: 100 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/studio/__tests__/useTimelineView.test.ts`
Expected: FAIL — cannot resolve `../useTimelineView`.

- [ ] **Step 3: Write the implementation**

Create `src/studio/useTimelineView.ts`:

```ts
import { useCallback, useEffect, useState } from "react";

export interface View {
  start: number;
  end: number;
}

export const MIN_VIEW_SPAN = 0.25; // seconds; tightest zoom
export const ZOOM_STEP = 2;
export const PAN_STEP = 0.15;
export const SELECTION_PAD = 0.05;

/** The single place view bounds are clamped. */
export function clampView(start: number, end: number, duration: number): View {
  if (!(duration > 0)) return { start: 0, end: 0 };
  const minSpan = Math.min(MIN_VIEW_SPAN, duration); // very short tracks
  const span = Math.min(Math.max(end - start, minSpan), duration);
  const s = Math.min(Math.max(start, 0), duration - span);
  return { start: s, end: s + span };
}

export function useTimelineView(duration: number) {
  const [view, setViewState] = useState<View>({ start: 0, end: 0 });

  // Reset to the full track whenever a new track finishes loading.
  useEffect(() => {
    setViewState(clampView(0, duration, duration));
  }, [duration]);

  const setView = useCallback(
    (start: number, end: number) => setViewState(clampView(start, end, duration)),
    [duration],
  );

  const fit = useCallback(
    () => setViewState(clampView(0, duration, duration)),
    [duration],
  );

  const zoomBy = useCallback(
    (factor: number, anchorTime: number) => {
      setViewState((v) => {
        const span = v.end - v.start;
        if (!(span > 0) || !(factor > 0)) return v;
        // Keep anchorTime at the same fractional position across the zoom.
        const frac = Math.min(Math.max((anchorTime - v.start) / span, 0), 1);
        const next = span / factor;
        const start = anchorTime - frac * next;
        return clampView(start, start + next, duration);
      });
    },
    [duration],
  );

  const panBy = useCallback(
    (fraction: number) => {
      setViewState((v) => {
        const span = v.end - v.start;
        return clampView(v.start + fraction * span, v.end + fraction * span, duration);
      });
    },
    [duration],
  );

  const zoomToSelection = useCallback(
    (start: number, end: number) => {
      setViewState(() => {
        const len = Math.max(0, end - start);
        const pad = len * SELECTION_PAD;
        let s = start - pad;
        let e = end + pad;
        const minSpan = Math.min(MIN_VIEW_SPAN, duration);
        if (e - s < minSpan) {
          const c = (start + end) / 2;
          s = c - minSpan / 2;
          e = c + minSpan / 2;
        }
        return clampView(s, e, duration);
      });
    },
    [duration],
  );

  return { view, setView, zoomBy, fit, panBy, zoomToSelection };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/studio/__tests__/useTimelineView.test.ts`
Expected: PASS (14 cases)

- [ ] **Step 5: Commit**

```bash
git add src/studio/useTimelineView.ts src/studio/__tests__/useTimelineView.test.ts
git commit -m "feat(studio): add timeline view state with zoom and pan clamping"
```

---

### Task 4: Engine buffer access and waveform data

**Files:**
- Modify: `src/studio/StudioEngine.ts` (add one accessor after the `duration` getter, ~line 60)
- Modify: `src/studio/useStudioEngine.ts`
- Test: `src/studio/__tests__/useStudioEngine.test.ts` (modify — the mock buffer must gain real sample data)
- Test: `src/studio/__tests__/StudioEngine.test.ts` (modify — add one case)

**Interfaces:**
- Consumes: `buildPeakPyramid`, `WaveformData`, `AudioSourceLike` from Task 2.
- Produces: `StudioEngine.getBuffer(stem: string): AudioBuffer | null`. `useStudioEngine` returns a new `waveforms: Record<string, WaveformData>` field; stems whose pyramid is not built yet are simply absent from the record.

The existing `useStudioEngine` test mocks `decodeAudioData` as `async () => ({ duration: 10 })` — a fake buffer with **only** a `duration`. Building a pyramid from that would throw, so the mock must become a realistic (but small) fake buffer. Keep `duration: 10` so the existing duration and region assertions still hold.

- [ ] **Step 1: Write the failing tests**

In `src/studio/__tests__/useStudioEngine.test.ts`, replace the `decodeAudioData` line inside `FakeCtx` with a fuller fake buffer:

```ts
    // Small but realistic fake AudioBuffer: 10s at 8kHz, constant +0.5.
    decodeAudioData = async () => ({
      duration: 10,
      numberOfChannels: 1,
      length: 80_000,
      sampleRate: 8000,
      getChannelData: () => new Float32Array(80_000).fill(0.5),
    });
```

Then append this case to the `describe("useStudioEngine", ...)` block:

```ts
  it("builds a waveform pyramid per stem after loading", async () => {
    const { result } = renderHook(() => useStudioEngine(job));
    await waitFor(() => expect(Object.keys(result.current.waveforms).sort())
      .toEqual(["drums", "vocals"]));
    const w = result.current.waveforms.vocals;
    expect(w.pyramid.length).toBe(80_000);
    expect(w.pyramid.sampleRate).toBe(8000);
    expect(w.pyramid.max[0]).toBeCloseTo(0.5, 5);
    expect(w.source.length).toBe(80_000);
  });
```

Append this case to `src/studio/__tests__/StudioEngine.test.ts` inside its `describe` block:

```ts
  it("exposes decoded buffers by stem and null for unknown stems", async () => {
    await engine.load([{ stem: "vocals", url: "u" }]);
    expect(engine.getBuffer("vocals")).not.toBeNull();
    expect(engine.getBuffer("nope")).toBeNull();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/studio/__tests__/useStudioEngine.test.ts src/studio/__tests__/StudioEngine.test.ts`
Expected: FAIL — `result.current.waveforms` is `undefined` and `engine.getBuffer` is not a function.

- [ ] **Step 3: Add the engine accessor**

In `src/studio/StudioEngine.ts`, immediately after the `duration` getter:

```ts
  getBuffer(stem: string): AudioBuffer | null {
    return this.tracks.find((t) => t.stem === stem)?.buffer ?? null;
  }
```

- [ ] **Step 4: Build pyramids in the hook**

In `src/studio/useStudioEngine.ts`, add to the imports:

```ts
import { buildPeakPyramid, type AudioSourceLike, type WaveformData } from "./peaks";
```

Add these module-level helpers below `decodeFromUrl`:

```ts
/** Let the browser paint between stems so a 4-stem job never freezes the UI. */
function yieldToPaint(): Promise<void> {
  return new Promise((resolve) => {
    const ric = (globalThis as { requestIdleCallback?: (cb: () => void) => void })
      .requestIdleCallback;
    if (typeof ric === "function") ric(() => resolve());
    else setTimeout(resolve, 0);
  });
}

async function buildWaveforms(
  engine: StudioEngine,
  stems: string[],
  isCancelled: () => boolean,
  emit: (stem: string, data: WaveformData) => void,
): Promise<void> {
  for (const stem of stems) {
    if (isCancelled()) return;
    const source = engine.getBuffer(stem) as AudioSourceLike | null;
    if (!source) continue;
    const pyramid = buildPeakPyramid(source);
    if (isCancelled()) return;
    emit(stem, { source, pyramid });
    await yieldToPaint();
  }
}
```

Add the state next to the other `useState` calls:

```ts
  const [waveforms, setWaveforms] = useState<Record<string, WaveformData>>({});
```

Inside the `useEffect`, declare a cancellation flag directly above `let raf = 0;`:

```ts
    let cancelled = false;
```

Extend the existing `engine.load(tracks).then(...)` callback — keep every existing line and append the build kick-off as its last statement:

```ts
      void buildWaveforms(
        engine,
        engine.stems,
        () => cancelled,
        (stem, data) => setWaveforms((w) => ({ ...w, [stem]: data })),
      );
```

In the effect's cleanup function, set the flag as the first statement:

```ts
      cancelled = true;
```

Reset the record when the job changes — add directly above `const ctx = new AudioContext();`:

```ts
    setWaveforms({});
```

Finally add `waveforms,` to the returned object, next to `channels,`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/studio/__tests__/useStudioEngine.test.ts src/studio/__tests__/StudioEngine.test.ts`
Expected: PASS — including the four pre-existing `useStudioEngine` cases, which the richer mock does not disturb.

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/studio/StudioEngine.ts src/studio/useStudioEngine.ts src/studio/__tests__/useStudioEngine.test.ts src/studio/__tests__/StudioEngine.test.ts
git commit -m "feat(studio): build per-stem peak pyramids from decoded buffers"
```

---

### Task 5: Canvas waveform renderer

**Files:**
- Rewrite: `src/studio/Waveform.tsx`
- Modify: `src/screens/Studio.tsx` (the `<Waveform>` usage, ~line 52)
- Modify: `src/styles.css` (the `.waveform > div` rule, ~line 965)
- Modify: `webapp/frontend/package.json` (drop `wavesurfer.js`)
- Test: `src/studio/__tests__/Waveform.test.tsx` (create)

**Interfaces:**
- Consumes: `WaveformData`, `computeColumns` (Task 2); `View` (Task 3).
- Produces: `Waveform({ data, view, height }: { data: WaveformData | null; view: View; height?: number })`. `data` is `null` while a stem is still decoding.

This task keeps the Studio at the full-track view (`{ start: 0, end: duration }`), so the app looks and behaves exactly as before — only the renderer changes. Real zoom arrives in Task 7.

- [ ] **Step 1: Write the failing test**

Create `src/studio/__tests__/Waveform.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Waveform } from "../Waveform";
import { buildPeakPyramid, type AudioSourceLike } from "../peaks";

const source: AudioSourceLike = {
  numberOfChannels: 1,
  length: 8000,
  sampleRate: 8000,
  getChannelData: () => new Float32Array(8000).fill(0.5),
};

describe("Waveform", () => {
  // jsdom implements neither a canvas 2D context nor ResizeObserver, so these
  // cases assert the component survives both being absent.
  it("mounts with no data without throwing", () => {
    render(<Waveform data={null} view={{ start: 0, end: 10 }} />);
    expect(screen.getByTestId("waveform")).toBeTruthy();
  });

  it("mounts with data without throwing", () => {
    const data = { source, pyramid: buildPeakPyramid(source) };
    render(<Waveform data={data} view={{ start: 0, end: 1 }} />);
    expect(screen.getByTestId("waveform")).toBeTruthy();
  });

  it("renders a canvas at the requested height", () => {
    const canvas = render(
      <Waveform data={null} view={{ start: 0, end: 10 }} height={64} />,
    ).getByTestId("waveform") as HTMLCanvasElement;
    expect(canvas.tagName).toBe("CANVAS");
    expect(canvas.style.height).toBe("64px");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/studio/__tests__/Waveform.test.tsx`
Expected: FAIL — the current `Waveform` requires a `url` prop and renders a `div`.

- [ ] **Step 3: Rewrite the component**

Replace the whole of `src/studio/Waveform.tsx`:

```tsx
import React, { useEffect, useRef } from "react";
import { computeColumns, type WaveformData } from "./peaks";
import type { View } from "./useTimelineView";

const FALLBACK_COLOR = "#7aa2f7";

export function Waveform({
  data,
  view,
  height = 48,
}: {
  data: WaveformData | null;
  view: View;
  height?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frame = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const draw = () => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return; // jsdom has no 2D context
      const rect = canvas.getBoundingClientRect();
      const cssW = Math.max(0, Math.floor(rect.width));
      const cssH = Math.max(0, Math.floor(rect.height || height));
      if (cssW === 0 || cssH === 0) return;

      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(cssW * dpr);
      canvas.height = Math.floor(cssH * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);

      const color =
        getComputedStyle(canvas).getPropertyValue("--accent").trim() || FALLBACK_COLOR;
      const mid = cssH / 2;

      ctx.fillStyle = color;
      ctx.globalAlpha = 0.35;
      ctx.fillRect(0, mid, cssW, 1); // centre line
      ctx.globalAlpha = 1;

      if (!data) return;
      const { min, max } = computeColumns(
        data.source, data.pyramid, view.start, view.end, cssW,
      );
      for (let i = 0; i < min.length; i++) {
        const yTop = mid - max[i] * mid;
        const yBot = mid - min[i] * mid;
        ctx.fillRect(i, yTop, 1, Math.max(1, yBot - yTop));
      }
    };

    const schedule = () => {
      cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(draw);
    };

    schedule();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(schedule) : null;
    ro?.observe(canvas);
    return () => {
      cancelAnimationFrame(frame.current);
      ro?.disconnect();
    };
  }, [data, view.start, view.end, height]);

  return (
    <div className="waveform">
      <canvas ref={canvasRef} data-testid="waveform" style={{ height }} />
    </div>
  );
}
```

The wrapping `div.waveform` keeps the existing `padding: var(--sp-3) var(--sp-4)`, so the canvas content box stays inset by the same 16px as `.region-track`'s margin and the two stay aligned.

- [ ] **Step 4: Update the CSS**

In `src/styles.css`, replace the `.waveform > div` rule with:

```css
.waveform > canvas {
  display: block;
  width: 100%;
}
```

- [ ] **Step 5: Update the Studio usage**

In `src/screens/Studio.tsx`, replace the `<Waveform ... />` line with:

```tsx
            <Waveform data={s.waveforms[c.stem] ?? null} view={{ start: 0, end: dur }} />
```

`stemUrl` was used only on that line, so drop it from the `../api/client` import, leaving `import { createMixdown, mixdownDownloadUrl } from "../api/client";`.

- [ ] **Step 6: Drop the wavesurfer dependency**

`wavesurfer.js` was imported in exactly one file, which no longer imports it. Remove the `"wavesurfer.js": "^7.8.0",` line from `webapp/frontend/package.json`, then:

```bash
npm install
```

Verify nothing references it:

Run: `npx vitest run 2>&1 | head -5` then `grep -rn "wavesurfer" src/ package.json`
Expected: no matches.

- [ ] **Step 7: Run the full suite and typecheck**

Run: `npm test`
Expected: PASS

Run: `npx tsc -b --noEmit` (never plain `tsc` — it would emit `.js` into `src/`)
Expected: no errors

- [ ] **Step 8: Commit**

```bash
git add src/studio/Waveform.tsx src/studio/__tests__/Waveform.test.tsx src/screens/Studio.tsx src/styles.css package.json package-lock.json
git commit -m "feat(studio): render stem waveforms on canvas, drop wavesurfer.js"
```

---

### Task 6: View-relative ruler mapping

**Files:**
- Modify: `src/studio/RegionTimeline.tsx`
- Modify: `src/screens/Studio.tsx` (pass `view` to `RegionTimeline`)
- Test: `src/studio/__tests__/RegionTimeline.test.tsx` (modify)

**Interfaces:**
- Consumes: `View` (Task 3); `fmtTime`, `decimalsForSpan` (Task 1).
- Produces: `RegionTimelineProps` gains a required `view: View`. `pct` and `timeFromClientX` become view-relative; the arrow-key nudge step becomes `Math.min(0.1, span / trackWidthPx)`.

Still no user-visible change: the Studio passes `{ start: 0, end: dur }`, at which every value is identical to today's. The six existing test **bodies and assertions are unchanged** — only the shared `setup()` helper gains the new prop.

- [ ] **Step 1: Update the existing test helper and add new cases**

In `src/studio/__tests__/RegionTimeline.test.tsx`, change `setup` to accept and pass a view (defaulting to the full track):

```tsx
function setup(region = { start: 10, end: 60 }, view = { start: 0, end: 100 }) {
  const onRegionChange = vi.fn();
  const onSeek = vi.fn();
  render(
    <RegionTimeline duration={100} currentTime={5} region={region} view={view}
      onRegionChange={onRegionChange} onSeek={onSeek} />,
  );
  const track = screen.getByTestId("region-track");
  vi.spyOn(track, "getBoundingClientRect").mockReturnValue(rect);
  return { onRegionChange, onSeek, track };
}
```

Append these cases to the `describe("RegionTimeline", ...)` block:

```tsx
  it("maps drags to the visible window when zoomed", () => {
    // 100px wide showing 40s-50s: x=50 is halfway, i.e. t=45.
    const { onRegionChange } = setup({ start: 42, end: 48 }, { start: 40, end: 50 });
    const handle = screen.getByRole("slider", { name: /region start/i });
    fireEvent.pointerDown(handle, { clientX: 20, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 50, pointerId: 1 });
    expect(onRegionChange).toHaveBeenLastCalledWith(45, 48);
  });

  it("seeks to view-relative time when zoomed", () => {
    const { onSeek, track } = setup({ start: 42, end: 48 }, { start: 40, end: 50 });
    fireEvent.pointerDown(track, { clientX: 25, pointerId: 1 });
    expect(onSeek).toHaveBeenCalledWith(42.5);
  });

  it("scales the arrow nudge to the zoom level", () => {
    // 100px showing 1s => 0.01s per pixel, finer than the 0.1s default.
    const { onRegionChange } = setup({ start: 42, end: 48 }, { start: 42, end: 43 });
    const start = screen.getByRole("slider", { name: /region start/i });
    fireEvent.keyDown(start, { key: "ArrowRight" });
    expect(onRegionChange.mock.calls[0][0]).toBeCloseTo(42.01, 6);
  });

  it("shows sub-second times when zoomed in", () => {
    setup({ start: 42.1837, end: 42.9 }, { start: 42, end: 43 });
    expect(screen.getByText(/0:42\.184 – 0:42\.900/)).toBeTruthy();
  });
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx vitest run src/studio/__tests__/RegionTimeline.test.tsx`
Expected: the four new cases FAIL (mapping still uses `0 → duration`); the six original cases still PASS.

- [ ] **Step 3: Make the mapping view-relative**

In `src/studio/RegionTimeline.tsx`, add the import and the `view` prop:

```tsx
import { fmtTime, decimalsForSpan } from "./time";
import type { View } from "./useTimelineView";
```

```tsx
export interface RegionTimelineProps {
  duration: number;
  currentTime: number;
  region: { start: number; end: number };
  view: View;
  onRegionChange: (start: number, end: number) => void;
  onSeek: (t: number) => void;
}
```

Replace `pct` and `timeFromClientX`, and add the span/decimals/nudge helpers:

```tsx
  const span = p.view.end - p.view.start;
  const dec = decimalsForSpan(span);

  const pct = (t: number) =>
    span > 0 ? Math.min(100, Math.max(0, ((t - p.view.start) / span) * 100)) : 0;

  const timeFromClientX = (clientX: number): number => {
    const el = trackRef.current;
    if (!el || span <= 0) return 0;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return 0;
    const x = Math.min(Math.max(clientX - rect.left, 0), rect.width);
    return p.view.start + (x / rect.width) * span;
  };

  /** One pixel of the current view, never coarser than the old 0.1s default. */
  const nudgeStep = (): number => {
    const w = trackRef.current?.getBoundingClientRect().width ?? 0;
    if (!(w > 0) || !(span > 0)) return 0.1;
    return Math.min(0.1, span / w);
  };
```

In `handleProps`, replace the `onKeyDown` step line:

```tsx
      const base = nudgeStep();
      const step = e.shiftKey ? base * 10 : base;
```

Replace the region-times span content so it uses the zoom-aware precision:

```tsx
          {fmtTime(p.region.start, dec)} – {fmtTime(p.region.end, dec)} ({fmtTime(p.region.end - p.region.start, dec)})
```

- [ ] **Step 4: Pass the view from the Studio**

In `src/screens/Studio.tsx`, add `view={{ start: 0, end: dur }}` to the `<RegionTimeline>` element.

- [ ] **Step 5: Run tests to verify all pass**

Run: `npx vitest run src/studio/__tests__/RegionTimeline.test.tsx`
Expected: PASS — all ten cases, including the six originals unchanged.

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/studio/RegionTimeline.tsx src/studio/__tests__/RegionTimeline.test.tsx src/screens/Studio.tsx
git commit -m "feat(studio): make the region ruler map to a view window"
```

---

### Task 7: Zoom controls and live view wiring

**Files:**
- Modify: `src/studio/RegionTimeline.tsx` (control cluster + two-row layout)
- Modify: `src/screens/Studio.tsx` (compose `useTimelineView`, feed every consumer)
- Modify: `src/styles.css`
- Test: `src/studio/__tests__/RegionTimeline.test.tsx` (modify)

**Interfaces:**
- Consumes: `useTimelineView`, `ZOOM_STEP` (Task 3).
- Produces: `RegionTimelineProps` gains `onZoom(factor: number, anchorTime: number): void`, `onFit(): void`, `onZoomToSelection(): void`. Buttons carry `aria-label`s `zoom in`, `zoom out`, `fit to track`, `zoom to selection`.

This is the task where zoom becomes real and user-visible.

- [ ] **Step 1: Write the failing tests**

In `src/studio/__tests__/RegionTimeline.test.tsx`, extend `setup` to capture the new callbacks:

```tsx
function setup(region = { start: 10, end: 60 }, view = { start: 0, end: 100 }) {
  const onRegionChange = vi.fn();
  const onSeek = vi.fn();
  const onZoom = vi.fn();
  const onFit = vi.fn();
  const onZoomToSelection = vi.fn();
  render(
    <RegionTimeline duration={100} currentTime={5} region={region} view={view}
      onRegionChange={onRegionChange} onSeek={onSeek}
      onZoom={onZoom} onFit={onFit} onZoomToSelection={onZoomToSelection} />,
  );
  const track = screen.getByTestId("region-track");
  vi.spyOn(track, "getBoundingClientRect").mockReturnValue(rect);
  return { onRegionChange, onSeek, onZoom, onFit, onZoomToSelection, track };
}
```

Append these cases:

```tsx
  it("zooms about the playhead when it is inside the view", () => {
    const { onZoom } = setup({ start: 10, end: 60 }, { start: 0, end: 100 });
    fireEvent.click(screen.getByRole("button", { name: /zoom in/i }));
    expect(onZoom).toHaveBeenCalledWith(2, 5); // currentTime is 5
  });

  it("zooms about the view centre when the playhead is off-screen", () => {
    const { onZoom } = setup({ start: 42, end: 48 }, { start: 40, end: 50 });
    fireEvent.click(screen.getByRole("button", { name: /zoom in/i }));
    expect(onZoom).toHaveBeenCalledWith(2, 45);
  });

  it("zooms out with the inverse factor", () => {
    const { onZoom } = setup();
    fireEvent.click(screen.getByRole("button", { name: /zoom out/i }));
    expect(onZoom).toHaveBeenCalledWith(0.5, 5);
  });

  it("fits and frames the selection", () => {
    const { onFit, onZoomToSelection } = setup();
    fireEvent.click(screen.getByRole("button", { name: /fit to track/i }));
    expect(onFit).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /zoom to selection/i }));
    expect(onZoomToSelection).toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/studio/__tests__/RegionTimeline.test.tsx`
Expected: FAIL — no `zoom in` button exists.

- [ ] **Step 3: Add the control cluster**

In `src/studio/RegionTimeline.tsx`, add to the imports:

```tsx
import { ZOOM_STEP } from "./useTimelineView";
```

Extend `RegionTimelineProps` with `onZoom`, `onFit`, `onZoomToSelection` (signatures in the Interfaces block above), and add the anchor helper next to `nudgeStep`:

```tsx
  /** Zoom about the playhead when it is visible, otherwise the view centre. */
  const zoomAnchor = (): number => {
    const { start, end } = p.view;
    return p.currentTime >= start && p.currentTime <= end
      ? p.currentTime
      : (start + end) / 2;
  };
```

Restructure the returned markup so the gutter holds two stacked cells and the ruler column holds the overview slot (filled in Task 10) above the track. Replace the `<div className="region-info">` block with:

```tsx
      <div className="region-info">
        <span className="region-times">
          {fmtTime(p.region.start, dec)} – {fmtTime(p.region.end, dec)} ({fmtTime(p.region.end - p.region.start, dec)})
        </span>
        <button aria-label="reset region" onClick={() => p.onRegionChange(0, p.duration)}>
          Reset
        </button>
      </div>
      <div className="zoom-controls">
        <button aria-label="zoom out" title="Zoom out"
          disabled={p.duration <= 0}
          onClick={() => p.onZoom(1 / ZOOM_STEP, zoomAnchor())}>−</button>
        <button aria-label="zoom in" title="Zoom in"
          disabled={p.duration <= 0}
          onClick={() => p.onZoom(ZOOM_STEP, zoomAnchor())}>+</button>
        <button aria-label="fit to track" title="Fit whole track"
          disabled={p.duration <= 0} onClick={p.onFit}>Fit</button>
        <button aria-label="zoom to selection" title="Zoom to selection"
          disabled={p.duration <= 0} onClick={p.onZoomToSelection}>⤢ Sel</button>
        <span className="view-span">{span > 0 ? `${span.toFixed(2)}s` : ""}</span>
      </div>
```

- [ ] **Step 4: Update the CSS**

In `src/styles.css`, change `.region-timeline` to a two-row grid and add the control styles:

```css
.region-timeline {
  display: grid;
  grid-template-columns: var(--track-gutter) 1fr;
  grid-template-rows: auto auto;
  align-items: center;
  border-bottom: 1px solid var(--border-subtle);
}

/* Explicit placement, so DOM order does not decide the layout and Task 10 can
   drop the overview into row 1 / column 2 without reordering anything. */
.region-info       { grid-column: 1; grid-row: 1; }
.zoom-controls     { grid-column: 1; grid-row: 2; }
.timeline-overview { grid-column: 2; grid-row: 1; }
.region-track      { grid-column: 2; grid-row: 2; }

.zoom-controls {
  display: flex;
  align-items: center;
  gap: var(--sp-1);
  padding: 0 var(--sp-3) var(--sp-2);
  border-right: 1px solid var(--border-subtle);
}

.zoom-controls button {
  min-height: 20px;
  padding: 2px 6px;
  font-size: 0.625rem;
  font-family: var(--font-mono);
  background: transparent;
  border: 1px solid var(--border-subtle);
  color: var(--text-muted);
}

.zoom-controls button:hover:not(:disabled) {
  color: var(--text);
  border-color: var(--accent-dim);
}

.zoom-controls button:disabled {
  opacity: 0.4;
}

.view-span {
  margin-left: auto;
  font-family: var(--font-mono);
  font-size: 0.5625rem;
  color: var(--text-dim);
  white-space: nowrap;
}
```

Keep the existing `.region-info` padding/border rule as-is, and keep `.region-track`'s `margin: 0 var(--sp-4)` untouched — that inset is what keeps the ruler aligned with the waveforms.

- [ ] **Step 5: Wire the live view in the Studio**

In `src/screens/Studio.tsx`, add the import and compose the hook:

```tsx
import { useTimelineView } from "../studio/useTimelineView";
```

```tsx
  const v = useTimelineView(dur);
  const span = v.view.end - v.view.start;
```

Replace the `pct` helper so the waveform overlay follows the view:

```tsx
  const pct = (t: number) =>
    span > 0 ? Math.min(100, Math.max(0, ((t - v.view.start) / span) * 100)) : 0;
```

Replace the `<RegionTimeline>` element:

```tsx
      <RegionTimeline
        duration={dur}
        currentTime={s.transport.currentTime}
        region={s.region}
        view={v.view}
        onRegionChange={s.setRegion}
        onSeek={s.seek}
        onZoom={v.zoomBy}
        onFit={v.fit}
        onZoomToSelection={() => v.zoomToSelection(s.region.start, s.region.end)}
      />
```

Replace the `<Waveform>` element's `view` prop with the live one:

```tsx
            <Waveform data={s.waveforms[c.stem] ?? null} view={v.view} />
```

`rangeSummary` keeps using `fmtTime(...)` with no decimals — the export panel describes the whole selection, not the zoomed view, so its format should not shift as you zoom.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/studio/__tests__/RegionTimeline.test.tsx`
Expected: PASS (14 cases)

Run: `npm test` then `npx tsc -b --noEmit`
Expected: PASS, no type errors

- [ ] **Step 7: Verify in the browser**

Run: `npm run dev`, open a completed job in Studio. Click `+` several times — the ruler, all stem waveforms, the dim overlay and the playhead should zoom together and stay aligned. `Fit` returns to the whole track. Drag a handle while zoomed; the readout should show milliseconds.

- [ ] **Step 8: Commit**

```bash
git add src/studio/RegionTimeline.tsx src/studio/__tests__/RegionTimeline.test.tsx src/screens/Studio.tsx src/styles.css
git commit -m "feat(studio): add timeline zoom controls wired to ruler, waveforms and overlay"
```

---

### Task 8: Wheel and keyboard shortcuts

**Files:**
- Modify: `src/studio/RegionTimeline.tsx`
- Modify: `src/screens/Studio.tsx`
- Test: `src/studio/__tests__/RegionTimeline.test.tsx` (modify)

**Interfaces:**
- Consumes: `onZoom` (Task 7); `ZOOM_STEP`, `PAN_STEP` (Task 3).
- Produces: `RegionTimelineProps` gains `onPan(fraction: number): void`.

**Critical detail:** React registers `wheel` on its root container as a **passive** listener, so `preventDefault()` inside an `onWheel` prop silently does nothing. The handler must be attached natively with `{ passive: false }` in a `useEffect`. `fireEvent.wheel` still reaches it.

- [ ] **Step 1: Write the failing tests**

Add `const onPan = vi.fn();` to `setup`, pass `onPan={onPan}` to the element, and return it. Then append:

```tsx
  it("ctrl+wheel zooms about the time under the cursor", () => {
    const { onZoom } = setup({ start: 42, end: 48 }, { start: 40, end: 50 });
    fireEvent.wheel(screen.getByTestId("region-track"), {
      deltaY: -100, ctrlKey: true, clientX: 30,
    });
    expect(onZoom).toHaveBeenCalledWith(2, 43); // 30% of 40s-50s
  });

  it("ctrl+wheel down zooms out", () => {
    const { onZoom } = setup({ start: 42, end: 48 }, { start: 40, end: 50 });
    fireEvent.wheel(screen.getByTestId("region-track"), {
      deltaY: 100, ctrlKey: true, clientX: 30,
    });
    expect(onZoom).toHaveBeenCalledWith(0.5, 43);
  });

  it("shift+wheel pans", () => {
    const { onPan } = setup();
    const track = screen.getByTestId("region-track");
    fireEvent.wheel(track, { deltaY: 100, shiftKey: true, clientX: 30 });
    expect(onPan).toHaveBeenCalledWith(0.15);
    fireEvent.wheel(track, { deltaY: -100, shiftKey: true, clientX: 30 });
    expect(onPan).toHaveBeenCalledWith(-0.15);
  });

  it("ignores a plain wheel so the page still scrolls", () => {
    const { onZoom, onPan } = setup();
    fireEvent.wheel(screen.getByTestId("region-track"), { deltaY: 100, clientX: 30 });
    expect(onZoom).not.toHaveBeenCalled();
    expect(onPan).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/studio/__tests__/RegionTimeline.test.tsx`
Expected: FAIL — the wheel cases record no calls.

- [ ] **Step 3: Attach a non-passive wheel listener**

In `src/studio/RegionTimeline.tsx`, add `useEffect` to the React import, add `PAN_STEP` to the `useTimelineView` import, add `onPan` to `RegionTimelineProps`, and add this effect above the `return`:

```tsx
  // React attaches wheel listeners on its root as passive, so preventDefault()
  // in an onWheel prop is a no-op. Attach natively instead.
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        p.onZoom(e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP, timeFromClientX(e.clientX));
      } else if (e.shiftKey) {
        e.preventDefault();
        p.onPan(e.deltaY > 0 ? PAN_STEP : -PAN_STEP);
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  });
```

The effect intentionally has **no dependency array**: it re-binds each render so the closure always sees the current `view` and callbacks. The listener is removed in cleanup every time, so no duplicates accumulate.

- [ ] **Step 4: Pass `onPan` from the Studio**

In `src/screens/Studio.tsx`, add to `<RegionTimeline>`:

```tsx
        onPan={v.panBy}
```

- [ ] **Step 5: Add the keyboard shortcuts**

In `src/screens/Studio.tsx`, add `useEffect`/`useRef` to the React import and add:

```tsx
  // Kept in a ref: currentTime changes every animation frame, and depending on
  // it directly would re-subscribe the listener 60x a second.
  const zoomAnchorRef = useRef(0);
  zoomAnchorRef.current =
    s.transport.currentTime >= v.view.start && s.transport.currentTime <= v.view.end
      ? s.transport.currentTime
      : (v.view.start + v.view.end) / 2;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || el?.isContentEditable) return;
      if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        v.zoomBy(ZOOM_STEP, zoomAnchorRef.current);
      } else if (e.key === "-") {
        e.preventDefault();
        v.zoomBy(1 / ZOOM_STEP, zoomAnchorRef.current);
      } else if (e.key === "0") {
        e.preventDefault();
        v.fit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [v.zoomBy, v.fit]);
```

Add `ZOOM_STEP` to the `useTimelineView` import in this file.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/studio/__tests__/RegionTimeline.test.tsx`
Expected: PASS (18 cases)

Run: `npm test` then `npx tsc -b --noEmit`
Expected: PASS, no type errors

- [ ] **Step 7: Verify in the browser**

Run: `npm run dev`. Ctrl+scroll over the ruler zooms toward the cursor; plain scroll still scrolls the page; Shift+scroll pans. Press `+`, `-`, `0`. Click into the export-name field and type `-` — the view must not change.

- [ ] **Step 8: Commit**

```bash
git add src/studio/RegionTimeline.tsx src/studio/__tests__/RegionTimeline.test.tsx src/screens/Studio.tsx
git commit -m "feat(studio): add ctrl+wheel zoom, shift+wheel pan and keyboard shortcuts"
```

---

### Task 9: Off-screen handle pinning

**Files:**
- Modify: `src/studio/RegionTimeline.tsx`
- Modify: `src/styles.css`
- Test: `src/studio/__tests__/RegionTimeline.test.tsx` (modify)

**Interfaces:**
- Consumes: `view` (Task 6).
- Produces: no new props. Handles outside the view get `data-offscreen="true"` and the `is-offscreen` class.

`aria-valuenow` keeps reporting the handle's **true** time, not the pinned edge, so assistive tech is never lied to.

- [ ] **Step 1: Write the failing tests**

```tsx
  it("pins an off-screen handle to the view edge and refuses to drag it", () => {
    // View 45s-50s; the start handle at 42s is off the left edge.
    const { onRegionChange } = setup({ start: 42, end: 48 }, { start: 45, end: 50 });
    const start = screen.getByRole("slider", { name: /region start/i });
    expect(start.getAttribute("data-offscreen")).toBe("true");
    expect(start.className).toContain("is-offscreen");
    expect(start.style.left).toBe("0%");
    fireEvent.pointerDown(start, { clientX: 0, pointerId: 1 });
    fireEvent.pointerMove(start, { clientX: 50, pointerId: 1 });
    expect(onRegionChange).not.toHaveBeenCalled();
  });

  it("still reports the true time of an off-screen handle", () => {
    setup({ start: 42, end: 48 }, { start: 45, end: 50 });
    const start = screen.getByRole("slider", { name: /region start/i });
    expect(start.getAttribute("aria-valuenow")).toBe("42");
  });

  it("leaves on-screen handles draggable", () => {
    const { onRegionChange } = setup({ start: 46, end: 48 }, { start: 45, end: 50 });
    const start = screen.getByRole("slider", { name: /region start/i });
    expect(start.getAttribute("data-offscreen")).toBe("false");
    fireEvent.pointerDown(start, { clientX: 20, pointerId: 1 });
    fireEvent.pointerMove(start, { clientX: 50, pointerId: 1 });
    expect(onRegionChange).toHaveBeenLastCalledWith(47.5, 48);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/studio/__tests__/RegionTimeline.test.tsx`
Expected: FAIL — no `data-offscreen` attribute.

- [ ] **Step 3: Implement pinning**

In `src/studio/RegionTimeline.tsx`, add the predicate next to `zoomAnchor`:

```tsx
  const isOffscreen = (t: number) => t < p.view.start || t > p.view.end;
```

Guard the drag in `handleProps` — replace the `onPointerDown` and `onPointerMove` bodies:

```tsx
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
      e.stopPropagation();
      const t = which === "start" ? p.region.start : p.region.end;
      if (isOffscreen(t)) return; // dragging a pinned handle would teleport it
      dragging.current = which;
      (e.target as Element).setPointerCapture?.(e.pointerId);
    },
```

Add the class and attribute to both handle elements — for the start handle:

```tsx
          className={`region-handle start${isOffscreen(p.region.start) ? " is-offscreen" : ""}`}
          data-offscreen={isOffscreen(p.region.start) ? "true" : "false"}
```

and the equivalent for the end handle using `p.region.end` and `region-handle end`.

`pct()` already clamps to `[0, 100]`, so the pinned handle lands exactly on the edge with no extra maths.

- [ ] **Step 4: Add the CSS**

```css
.region-handle.is-offscreen {
  pointer-events: none;
  opacity: 0.55;
}

.region-handle.is-offscreen::after {
  width: 2px;
  background: var(--text-dim);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/studio/__tests__/RegionTimeline.test.tsx`
Expected: PASS (21 cases)

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/studio/RegionTimeline.tsx src/studio/__tests__/RegionTimeline.test.tsx src/styles.css
git commit -m "feat(studio): pin off-screen region handles to the view edge"
```

---

### Task 10: Timeline overview strip

**Files:**
- Create: `src/studio/TimelineOverview.tsx`
- Modify: `src/studio/RegionTimeline.tsx` (render it in the first ruler-column row)
- Modify: `src/styles.css`
- Test: `src/studio/__tests__/TimelineOverview.test.tsx` (create)

**Interfaces:**
- Consumes: `View` (Task 3).
- Produces: `TimelineOverview({ duration, view, region, currentTime, onViewChange }: { duration: number; view: View; region: { start: number; end: number }; currentTime: number; onViewChange: (start: number, end: number) => void })`. `RegionTimelineProps` gains `onViewChange: (start: number, end: number) => void`.

Always rendered — at Fit the window box simply spans the full width — so the layout never jumps as zoom changes.

- [ ] **Step 1: Write the failing test**

Create `src/studio/__tests__/TimelineOverview.test.tsx`:

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { TimelineOverview } from "../TimelineOverview";

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
  left: 0, top: 0, width: 100, height: 18, right: 100, bottom: 18, x: 0, y: 0,
  toJSON: () => ({}),
} as DOMRect;

function setup(view = { start: 40, end: 50 }) {
  const onViewChange = vi.fn();
  render(
    <TimelineOverview duration={100} view={view} region={{ start: 42, end: 48 }}
      currentTime={5} onViewChange={onViewChange} />,
  );
  const track = screen.getByTestId("overview-track");
  vi.spyOn(track, "getBoundingClientRect").mockReturnValue(rect);
  return { onViewChange, track };
}

describe("TimelineOverview", () => {
  it("positions the window box over the visible span", () => {
    setup();
    const box = screen.getByTestId("overview-window");
    expect(box.style.left).toBe("40%");
    expect(box.style.width).toBe("10%");
  });

  it("spans the full width when fitted", () => {
    setup({ start: 0, end: 100 });
    const box = screen.getByTestId("overview-window");
    expect(box.style.left).toBe("0%");
    expect(box.style.width).toBe("100%");
  });

  it("centres the span where the background is clicked", () => {
    const { onViewChange, track } = setup();
    fireEvent.pointerDown(track, { clientX: 20, pointerId: 1 });
    expect(onViewChange).toHaveBeenCalledWith(15, 25); // 20s +/- half of a 10s span
  });

  it("drags the window box to pan, preserving the grab offset", () => {
    const { onViewChange } = setup();
    const box = screen.getByTestId("overview-window");
    // Grab at 45s (5s into a 40-50s window), drop at 60s => window 55-65.
    fireEvent.pointerDown(box, { clientX: 45, pointerId: 1 });
    fireEvent.pointerMove(box, { clientX: 60, pointerId: 1 });
    expect(onViewChange).toHaveBeenLastCalledWith(55, 65);
  });

  it("does not centre the view when the box itself is grabbed", () => {
    const { onViewChange } = setup();
    fireEvent.pointerDown(screen.getByTestId("overview-window"), {
      clientX: 45, pointerId: 1,
    });
    expect(onViewChange).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/studio/__tests__/TimelineOverview.test.tsx`
Expected: FAIL — cannot resolve `../TimelineOverview`.

- [ ] **Step 3: Write the component**

Create `src/studio/TimelineOverview.tsx`:

```tsx
import React, { useRef } from "react";
import type { View } from "./useTimelineView";

export interface TimelineOverviewProps {
  duration: number;
  view: View;
  region: { start: number; end: number };
  currentTime: number;
  onViewChange: (start: number, end: number) => void;
}

export function TimelineOverview(p: TimelineOverviewProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const grabOffset = useRef<number | null>(null);

  const span = p.view.end - p.view.start;
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

  return (
    <div
      className="timeline-overview"
      data-testid="overview-track"
      ref={trackRef}
      onPointerDown={(e) => {
        // Background click: centre the current span on that time.
        const t = timeFromClientX(e.clientX);
        p.onViewChange(t - span / 2, t + span / 2);
      }}
    >
      <div className="overview-tick" style={{ left: `${pct(p.region.start)}%` }} />
      <div className="overview-tick" style={{ left: `${pct(p.region.end)}%` }} />
      <div className="overview-playhead" style={{ left: `${pct(p.currentTime)}%` }} />
      <div
        className="overview-window"
        data-testid="overview-window"
        style={{ left: `${pct(p.view.start)}%`, width: `${pct(p.view.end) - pct(p.view.start)}%` }}
        onPointerDown={(e) => {
          e.stopPropagation(); // grabbing the box must not also centre the view
          grabOffset.current = timeFromClientX(e.clientX) - p.view.start;
          (e.target as Element).setPointerCapture?.(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (grabOffset.current === null) return;
          const start = timeFromClientX(e.clientX) - grabOffset.current;
          p.onViewChange(start, start + span);
        }}
        onPointerUp={() => {
          grabOffset.current = null;
        }}
      />
    </div>
  );
}
```

- [ ] **Step 4: Add the CSS**

```css
.timeline-overview {
  position: relative;
  height: 18px;
  margin: var(--sp-2) var(--sp-4) 0;
  background: var(--surface-raise);
  border-radius: 2px;
  cursor: pointer;
}

.overview-window {
  position: absolute;
  top: 0;
  bottom: 0;
  background: rgba(122, 162, 247, 0.22);
  border: 1px solid var(--accent-dim);
  border-radius: 2px;
  cursor: grab;
  touch-action: none;
}

.overview-window:active {
  cursor: grabbing;
}

.overview-tick {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--accent);
  pointer-events: none;
}

.overview-playhead {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--text-dim);
  pointer-events: none;
}
```

- [ ] **Step 5: Render it inside the ruler**

In `src/studio/RegionTimeline.tsx`, import it, add `onViewChange` to `RegionTimelineProps`, and render it anywhere inside the `.region-timeline` element — Task 7's CSS pins `.timeline-overview` to grid row 1 / column 2 explicitly, so DOM order does not matter:

```tsx
import { TimelineOverview } from "./TimelineOverview";
```

```tsx
      <TimelineOverview
        duration={p.duration}
        view={p.view}
        region={p.region}
        currentTime={p.currentTime}
        onViewChange={p.onViewChange}
      />
```

In `src/screens/Studio.tsx`, add to `<RegionTimeline>`:

```tsx
        onViewChange={v.setView}
```

- [ ] **Step 6: Run the full suite**

Run: `npx vitest run src/studio/__tests__/TimelineOverview.test.tsx`
Expected: PASS (5 cases)

Run: `npm test` then `npx tsc -b --noEmit`
Expected: PASS, no type errors

- [ ] **Step 7: Verify in the browser**

Run: `npm run dev`. Zoom in — the overview box should shrink; drag it to scrub across the track while the ruler and every waveform follow. Region ticks should stay put in the overview while the zoomed ruler moves. At `Fit` the box fills the strip.

- [ ] **Step 8: Commit**

```bash
git add src/studio/TimelineOverview.tsx src/studio/__tests__/TimelineOverview.test.tsx src/studio/RegionTimeline.tsx src/screens/Studio.tsx src/styles.css
git commit -m "feat(studio): add full-track overview strip for panning while zoomed"
```

---

## Final Verification

- [ ] Run the whole suite: `npm test` — all files pass.
- [ ] Typecheck: `npx tsc -b --noEmit` — clean.
- [ ] Build: `npm run build` — succeeds.
- [ ] Confirm `grep -rn "wavesurfer" src/ package.json` returns nothing.
- [ ] Confirm no stray compiled artefacts: `git status --porcelain src/` shows no untracked `.js` beside a `.tsx`.
- [ ] Manual check of the acceptance path: open Studio on a real job, zoom to a drum transient, place both handles on it, `Play selection` to audition, export, and confirm the downloaded file's length matches the readout.
