# Studio Timeline Zoom — Design

**Date:** 2026-08-01
**Status:** Approved by user (brainstorming session)
**Branch:** `feature/studio-timeline-zoom`

## Goal

In Studio mode, let the user zoom the timeline in and out so the export region's
start and end markers can be placed precisely. Today the ruler maps the whole
track across the waveform column, so on a 4-minute track in a ~900 px column one
pixel is ~0.27 s — that is the current precision floor. After this change the
user can zoom to a quarter-second across the full width (~0.3 ms/px), place both
handles on an exact transient, and zoom back out.

Zoom is a **view** concern only. It never changes `region`, playback, or what
gets exported.

## Decisions Made

- **Zoom model:** whole timeline, DAW-style. The ruler, every stem waveform, the
  dim overlay and the playhead share one zoomed viewport. Rejected: a
  magnifier-only strip (can't inspect the stems at high zoom).
- **Navigation:** a full-track overview strip pinned above the zoomed ruler with
  a draggable viewport box, plus `Shift`+wheel panning. Rejected: playhead
  auto-follow (fights handle dragging near the view edge).
- **Depth:** max zoom shows 0.25 s across the full width. Rejected:
  sample-accurate zoom — wavesurfer renders peak-summarised data and going below
  a few ms/px means custom drawing anyway (which we are now doing, but the extra
  depth is not needed for the stated goal).
- **Rendering:** replace wavesurfer.js with our own canvas renderer fed from the
  `AudioBuffer`s `StudioEngine` already holds. Chosen over wavesurfer's native
  `minPxPerSec` zoom (an ~835,000 px-wide scroll area per stem at max zoom, ×4
  instances, with scroll-sync drift between five independently scrolling
  elements) and over feeding wavesurfer sliced peaks (fights the library's
  ownership of the whole file). Side benefit: `Waveform.tsx` currently passes a
  URL to wavesurfer, so every stem is **downloaded and decoded twice** — once by
  the engine, once by wavesurfer. This removes the duplicate.
- **Backward compatibility:** at full-track view every mapping, nudge step and
  readout format is identical to today's behaviour. All six existing
  `RegionTimeline` tests pass unchanged.

## View Model

`view = { start: number; end: number }` (seconds), owned by a new
`useTimelineView` hook. Every horizontal position on screen — ruler, waveform
canvases, dim overlay, playhead, region handles — maps
`[view.start, view.end] → [0, width]`.

Constants:

| Name             | Value | Meaning                                  |
| ---------------- | ----- | ---------------------------------------- |
| `MIN_VIEW_SPAN`  | 0.25  | seconds; tightest zoom                   |
| `ZOOM_STEP`      | 2     | factor per `[+]`/`[−]` click or wheel notch |
| `PAN_STEP`       | 0.15  | fraction of a span per `Shift`+wheel notch |
| `SELECTION_PAD`  | 0.05  | fraction of region length padded on each side |
| `PEAK_BUCKET`    | 256   | samples per peak-pyramid bucket          |

### `setView(start, end)` — the single clamping point

```
if (duration <= 0) return { start: 0, end: 0 };
const minSpan = Math.min(MIN_VIEW_SPAN, duration);   // very short tracks
const span    = Math.min(Math.max(end - start, minSpan), duration);
const s       = Math.min(Math.max(start, 0), duration - span);
return { start: s, end: s + span };
```

Consequences: the view can never be narrower than `MIN_VIEW_SPAN`, never wider
than the track, and never scrolls past either end.

### Operations

- `zoomBy(factor, anchorTime)` — new span is `span / factor`; the anchor keeps
  its fractional position in the view, then `setView` clamps:

  ```
  const frac  = span > 0 ? (anchorTime - view.start) / span : 0.5;
  const next  = span / factor;
  const start = anchorTime - clamp(frac, 0, 1) * next;
  setView(start, start + next);
  ```

  Near either end the clamp wins and the anchor drifts — correct and expected.
- `fit()` — `setView(0, duration)`.
- `zoomToSelection(region)` — pad by `SELECTION_PAD × region length` on each
  side. If the padded span is under `MIN_VIEW_SPAN`, centre a `MIN_VIEW_SPAN`
  window on the region's midpoint instead.
- `panBy(fraction)` — shift both bounds by `fraction × span`; `setView` clamps
  at the track ends.

`view` initialises to `{ 0, 0 }` and is set to the full track once `duration`
becomes non-zero.

## Controls

Rendered in the ruler's gutter cell and on the ruler itself:

- `[−]` `[+]` — `zoomBy(ZOOM_STEP, …)` and `zoomBy(1 / ZOOM_STEP, …)`, anchored
  on the playhead when it is inside the view, otherwise the view centre.
- `[Fit]` — whole track.
- `[⤢ Sel]` — `zoomToSelection`.
- `Ctrl`/`Cmd` + wheel over the ruler — zoom about the time under the cursor.
  Plain wheel is **not** intercepted, so the page still scrolls normally.
- `Shift` + wheel over the ruler — `panBy(±PAN_STEP)`.
- Keyboard on the Studio: `+`/`=` zoom in, `-` zoom out, `0` fit. Attached as a
  `window` listener in `Studio.tsx`, ignored when the event target is an
  `input`, `textarea`, or `contentEditable` element (so typing an export name is
  unaffected).

All zoom controls are disabled while `duration === 0`.

## Precision Readouts

`fmtTime(t, decimals = 0)` in `studio/time.ts`:

- `decimals === 0` keeps today's exact implementation (`Math.floor`, `m:ss`), so
  existing output and tests are untouched.
- `decimals > 0` rounds to that precision **before** splitting minutes and
  seconds, so 59.96 s at one decimal renders `1:00.0`, not `0:60.0`.
- Negative input clamps to 0.

The Studio picks decimals from the visible span, first match wins:

| Test          | Decimals | Example    |
| ------------- | -------- | ---------- |
| `span > 60`   | 0        | `0:43`     |
| `span > 10`   | 1        | `0:43.2`   |
| `span > 1`    | 2        | `0:43.18`  |
| otherwise     | 3        | `0:43.184` |

The same `decimals` applies to the region start, end, **and** length, so at
full-track view the readout still reads `0:10 – 1:00 (0:50)`.

## Handle Nudging

Arrow-key step becomes `Math.min(0.1, span / trackWidthPx)` — one pixel of the
current view, capped so it never becomes coarser than today's 0.1 s.
`Shift` multiplies by 10. `trackWidthPx` comes from the ruler's
`getBoundingClientRect().width` at keydown time; if it is 0, the step falls back
to 0.1.

At full track (duration 100 s, width 100 px) this yields 0.1 s and 1 s —
identical to current behaviour. At max zoom it yields ~0.3 ms.

## Off-Screen Handles

When a handle's time falls outside `[view.start, view.end]` it renders pinned to
that edge with an `is-offscreen` class (arrow affordance) and
`pointer-events: none` — dragging it there would teleport the selection. The
overview strip still shows its true position, and `[⤢ Sel]` brings it back.

The dim overlay needs no special casing: `pct()` clamps to `[0, 100]`, so a
region edge outside the view collapses its dim rectangle to zero width.

## Components

### `studio/peaks.ts` (new, pure — no DOM)

Typed against a minimal structural interface rather than `AudioBuffer`, so tests
can pass a plain object (jsdom has no `AudioBuffer`):

```ts
interface AudioSourceLike {
  numberOfChannels: number;
  length: number;
  sampleRate: number;
  getChannelData(i: number): Float32Array;
}

interface PeakPyramid {
  min: Float32Array;      // one entry per bucket
  max: Float32Array;
  bucketSize: number;
  sampleRate: number;
  length: number;         // source sample count
}

// What a Waveform needs to draw itself at any zoom level: the pyramid for
// zoomed-out columns, the source for the raw-sample tier.
interface WaveformData {
  source: AudioSourceLike;
  pyramid: PeakPyramid;
}
```

- `buildPeakPyramid(source, bucketSize = PEAK_BUCKET)` — one pass over the
  channel-averaged (mono) samples. ~320 KB per stem for a 4-minute track.
- `computeColumns(source, pyramid, viewStart, viewEnd, width)` →
  `{ min: Float32Array(width), max: Float32Array(width) }`.
  - Returns empty arrays when `width <= 0` or `viewEnd <= viewStart`.
  - Two tiers by `samplesPerPixel = (viewEnd - viewStart) * sampleRate / width`:
    **≥ `bucketSize`** reads the pyramid (cheap when zoomed out); **<
    `bucketSize`** reads raw samples directly (avoids stair-stepping at high
    zoom). This tier switch is what makes max zoom look correct.
  - Each column covers `[floor(t0 × sr), max(s0 + 1, floor(t1 × sr))]` clamped to
    the source length. Columns past the end of a short stem yield `0/0`.

### `studio/useTimelineView.ts` (new)

Owns `view` plus `setView`, `zoomBy`, `fit`, `zoomToSelection`, `panBy`. Pure
state, no audio — independently testable, and keeps `useStudioEngine` about
audio only. `Studio.tsx` composes both hooks.

### `studio/Waveform.tsx` (rewritten)

Props `{ data: WaveformData | null, view, height }`. `null` means the stem is
still decoding — the canvas renders empty rather than erroring.

- Renders a `<canvas>` sized to its container via `ResizeObserver`, scaled by
  `devicePixelRatio`.
- Redraws on `view`/size change, coalesced through `requestAnimationFrame`.
- Draws the min/max envelope plus a centre line, colour read from `--accent`
  (already `#7aa2f7`, the colour `Waveform.tsx` hardcodes today) with that value
  as the fallback.
- Guards a null 2D context — jsdom does not implement one, and the guard is
  harmless in production.
- No fetch, no URL, no wavesurfer.

### `studio/TimelineOverview.tsx` (new)

Purely presentational full-track strip.
Props `{ duration, view, region, currentTime, onViewChange }`.

- Viewport box positioned from `view`, dragged with pointer capture to pan.
- Tick marks for `region.start`/`region.end`, dot for `currentTime`.
- Clicking the background centres the current span on that time.
- Always rendered — at Fit the box spans the full width — so the layout never
  jumps when zoom changes.

### `studio/RegionTimeline.tsx` (modified)

- `pct()` and `timeFromClientX()` switch from `0 → duration` to view bounds.
- Wheel handler: `Ctrl`/`Cmd` → `zoomBy` about the cursor time; `Shift` →
  `panBy`. Both `preventDefault`; a plain wheel is ignored.
- Off-screen handle pinning; zoom-scaled arrow nudge.
- Stays on the existing `--track-gutter | 1fr` grid, now two rows:

```
[ 0:43.184 – 0:46.902   Reset ] [ overview strip, draggable box          ]
[ [−] [+] [Fit] [⤢ Sel]  8.0s ] [ zoomed ruler: shade, handles, playhead ]
```

- New props: `view`, `onZoom`, `onPan`, `onFit`, `onZoomToSelection`. Still
  purely presentational — no engine or store imports.

### `studio/StudioEngine.ts` (modified)

One read accessor for the decoded buffers (`getBuffer(stem)`). Nothing else
changes.

### `studio/useStudioEngine.ts` (modified)

After `engine.load(...)` resolves, build a peak pyramid per stem and expose
`waveforms: Record<string, WaveformData>` — each entry pairing the pyramid with
the buffer from `engine.getBuffer(stem)`. Build them **one stem at a time,
yielding between stems** (`requestIdleCallback`, falling back to
`setTimeout(0)`) so the main thread paints between passes — waveforms appear
progressively instead of freezing the UI for ~300 ms on a 4-stem job. Stems not
yet built are simply absent from the record, so `Waveform` receives `null`.

### `screens/Studio.tsx` (modified)

Composes `useTimelineView`, passes `view` to `RegionTimeline`, each `Waveform`,
and the `.tracks-overlay` dim/playhead math. Hosts the keyboard shortcut
listener. Passes each stem's `WaveformData` (or `null`) to its `Waveform`.

### `package.json`

Remove the `wavesurfer.js` dependency. It is imported in exactly one file today.

## Error Handling and Edge Cases

- `duration === 0` (still loading): `view = { 0, 0 }`, every mapping guard
  returns 0, zoom controls disabled.
- Stems of differing lengths: `duration` is the max; shorter stems render blank
  past their end (columns yield `0/0`).
- Container resize: `ResizeObserver` triggers recompute + redraw. The ruler
  already reads `getBoundingClientRect()` per event, so it is resize-safe.
- Region shorter than `MIN_VIEW_SPAN` on `[⤢ Sel]`: centre a `MIN_VIEW_SPAN`
  window on its midpoint.
- Very short tracks (under `MIN_VIEW_SPAN`): `minSpan` collapses to `duration`,
  so zoom is a no-op rather than an error.

## Testing

New:

- `peaks.test.ts` — pyramid min/max against a synthetic signal (e.g. a known
  sine plus an impulse); `computeColumns` returns exactly `width` columns; the
  pyramid tier and the raw tier agree on a shared window; degenerate cases
  (zero-length source, `width` 0, span smaller than one sample, window past the
  end of the source).
- `useTimelineView.test.ts` — `setView` clamping (min span, max span, no
  scrolling past either end); `zoomBy` keeps the anchor at a fixed screen
  fraction; `zoomBy` at an edge clamps rather than overscrolling;
  `zoomToSelection` padding and the sub-min-span case; `fit` restores the full
  track; `panBy` clamps.
- `TimelineOverview.test.tsx` — dragging the box emits a clamped view; clicking
  the background centres.
- `time.test.ts` — `decimals` argument, including the 59.96 → `1:00.0` rounding
  carry and the unchanged `decimals === 0` path.

Extended:

- `RegionTimeline.test.tsx` — **the six existing tests must pass unchanged**
  (guards the "zoomed out behaves exactly like today" property). New: with a
  zoomed view, dragging a handle maps to view-relative time; an off-screen
  handle renders pinned and does not drag; `Ctrl`+wheel calls `onZoom` with the
  time under the cursor; `Shift`+wheel calls `onPan`.

No existing test renders `Studio` or `Waveform`, so removing wavesurfer does not
touch the current suite.

## Out of Scope (YAGNI)

- Vertical / amplitude zoom.
- Snapping — zero-crossing, beat, or grid.
- Auto-scroll following the playhead during playback.
- Per-stem zoom levels.
- Persisting zoom across sessions.
- Numeric time-entry fields for the region (still out of scope from the
  2026-07-07 region design).
- Any backend change. Export already receives `start_sec`/`end_sec` in seconds
  and is unaffected by zoom.
