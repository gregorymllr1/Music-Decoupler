# Studio Export Region Markers — Design

**Date:** 2026-07-07
**Status:** Approved by user (brainstorming session)
**Branch:** `feature/demucs-stem-studio`

## Goal

In Studio mode, let the user isolate a fragment of a song for export by placing
draggable **start** and **end** markers on the timeline, in addition to the
existing playhead. Exporting a mixdown renders only the audio between the
markers. The user can audition the selection before exporting.

## Decisions Made

- **Region scope:** Export + audition. Markers define the export range, and a
  "Play selection" control plays exactly that range (playhead jumps to the
  start marker, playback stops at the end marker). Normal play/pause/seek is
  unchanged. No looping.
- **Marker UI:** A timeline ruler strip above the track rows holds the
  draggable handles, shaded region, and playhead; the selected region is also
  shaded vertically across all stem waveforms (areas outside the selection are
  dimmed), DAW-style.
- **Trim location:** Server-side. The existing mixdown renderer
  (`webapp/backend/app/core/mix.py`) slices the mixed numpy array before
  encoding. Client-side rendering/encoding was rejected: it would duplicate
  the export path and require browser encoder libraries for MP3/FLAC.

## Region Model

- `region = { start: number; end: number }` (seconds), owned by
  `useStudioEngine`, initialized to the full track (`0 → duration`) once stems
  finish loading.
- A full-width region means "export everything" — identical to current
  behavior. There is no separate enabled/disabled mode.
- `setRegion(start, end)` clamps in one place:
  `0 ≤ start < end ≤ duration`, minimum gap 0.1 s.
- A **Reset** control restores the region to full width.

## Components

### `RegionTimeline.tsx` (new, `webapp/frontend/src/studio/`)

Ruler strip rendered above the track rows in `Studio.tsx`.

- Uses the same gutter-width | `1fr` grid as `.track-row` so the ruler aligns
  with the waveform column; the left cell holds the region time labels
  (`start – end (length)`) and the Reset button.
- The gutter width becomes a shared CSS variable (`--track-gutter`, 160px,
  overridden to 120px in the existing `max-width: 600px` media query) used by
  `.track-row`, the ruler, and the waveform overlay so all three stay aligned
  at every breakpoint.
- Shaded div between the markers; translucent dim outside them.
- Two drag handles (start/end) using pointer events with
  `setPointerCapture`. Keyboard accessible: each handle is a focusable
  `role="slider"` with `aria-valuemin/max/now`; ArrowLeft/Right nudge
  ±0.1 s, Shift+Arrow ±1 s.
- Playhead line at `currentTime`.
- Clicking the ruler (not on a handle) seeks.
- Props: `{ duration, currentTime, region, onRegionChange, onSeek }`.
  Purely presentational — no engine or store imports.

### Waveform overlay (in `Studio.tsx` + CSS)

- The tracks area becomes `position: relative` and gains an absolutely
  positioned, `pointer-events: none` overlay covering the waveform column
  (left offset `var(--track-gutter)` + waveform horizontal padding).
- Two translucent dark divs dim the audio outside `[start, end]`; a 1–2 px
  vertical playhead line spans all rows.
- The ruler and the overlay must use identical horizontal padding so
  time→pixel mapping matches the rendered waveforms.

### `StudioEngine.ts` (modified)

- `play(stopAt?: number)`: when `stopAt` is given, sources are scheduled with
  a bounded duration (`src.start(0, offset, stopAt - offset)`) so the stop is
  sample-accurate. When playback reaches `stopAt`, the engine flips to paused
  with `offset = stopAt` (guarded so a manual pause/stop does not double-fire).
- `playSelection(start, end)` = seek to `start`, then `play(end)`.
- Existing `play()/pause()/stop()/seek()` behavior unchanged.

### `Transport.tsx` (modified)

- New **Play selection** button (`aria-label="play selection"`) next to
  play/stop. Disabled while stems are still loading (`duration === 0`).

### `ExportPanel.tsx` (modified)

- Shows what will export: `Selection 0:12 – 1:34 (1:22)` when the region is
  narrower than the full track, otherwise `Full track`.
- No new inputs; name/format flow unchanged.

### `useStudioEngine.ts` (modified)

- Owns `region` state; exposes `region`, `setRegion`, `resetRegion`,
  `playSelection`.
- `buildMixdownRequest` includes `start_sec`/`end_sec` **only when** the
  region is narrower than the full track; a full-width region produces a
  request identical to today's (backward compatible).

## Backend

### `schemas.py`

- `MixdownRequest` gains `start_sec: Optional[float] = None` and
  `end_sec: Optional[float] = None`.
- Validation: if either is set, require `start_sec ≥ 0`,
  `end_sec > start_sec` (defaults: `start_sec` 0 when only `end_sec` given;
  missing `end_sec` means "to the end"). Invalid ranges → 422.

### `mix.py`

- `render_mixdown(..., start_sec=None, end_sec=None)`: after `mix_tracks`,
  slice `mix[int(start_sec * sr) : int(end_sec * sr)]` (each bound applied
  only when provided), clamping indices to the array length. If the clamped
  slice is empty, fall back to the existing minimal-silence output (one zero
  frame), matching `mix_tracks`' empty behavior.

### `routes_mixdown.py`

- Pass `req.start_sec` / `req.end_sec` through to `render_mixdown`. The spec
  JSON stored with the mixdown row already serializes the full request, so
  the range is recorded automatically.

## Error Handling

- All region clamping on the frontend happens inside `setRegion`.
- Backend re-clamps defensively against actual audio length (frontend
  duration comes from decoded buffers and may differ by a few ms from the
  files on disk).
- Range outside the audio entirely → empty slice → minimal-silence file, not
  an error (mirrors existing all-muted behavior).

## Testing

Frontend (Vitest + RTL, existing patterns):
- `RegionTimeline`: renders handles/labels; keyboard nudge fires
  `onRegionChange` with clamped values; pointer drag updates the region;
  ruler click seeks.
- `useStudioEngine`: region initializes to full width; `setRegion` clamps;
  `buildMixdownRequest` includes `start_sec`/`end_sec` only for a narrowed
  region.
- `StudioEngine` (mocked AudioContext, as in `StudioEngine.test.ts`):
  `play(stopAt)` schedules bounded sources and flips to paused at `stopAt`;
  manual pause before `stopAt` doesn't double-fire.

Backend (pytest, existing patterns):
- `mix.render_mixdown` with a range → output frame count matches
  `(end - start) * sr`; out-of-bounds ranges clamp; empty range → silence.
- Schema: `end_sec ≤ start_sec` rejected.
- Route: POST mixdown with range succeeds and file duration matches.

## Out of Scope (YAGNI)

- Looping playback between markers.
- Numeric time-entry fields, snapping, multiple/named regions, per-stem
  regions.
- Trimming stem downloads (region applies to mixdown export only).
