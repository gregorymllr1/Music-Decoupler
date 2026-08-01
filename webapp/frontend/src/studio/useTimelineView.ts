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

/** Zoom anchor: the playhead when visible, otherwise the view centre. */
export function zoomAnchor(view: View, currentTime: number): number {
  return currentTime >= view.start && currentTime <= view.end
    ? currentTime
    : (view.start + view.end) / 2;
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
