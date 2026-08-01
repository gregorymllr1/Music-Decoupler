import React, { useEffect, useRef } from "react";
import { fmtTime, decimalsForSpan } from "./time";
import { ZOOM_STEP, PAN_STEP, zoomAnchor, type View } from "./useTimelineView";
import { TimelineOverview } from "./TimelineOverview";

export interface RegionTimelineProps {
  duration: number;
  currentTime: number;
  region: { start: number; end: number };
  view: View;
  onRegionChange: (start: number, end: number) => void;
  onSeek: (t: number) => void;
  onZoom: (factor: number, anchorTime: number) => void;
  onFit: () => void;
  onZoomToSelection: () => void;
  onPan: (fraction: number) => void;
  onViewChange: (start: number, end: number) => void;
}

export function RegionTimeline(p: RegionTimelineProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<"start" | "end" | null>(null);

  const span = p.view.end - p.view.start;
  const dec = decimalsForSpan(span);

  const pct = (t: number) =>
    span > 0 ? Math.min(100, Math.max(0, ((t - p.view.start) / span) * 100)) : 0;

  const isOffscreen = (t: number) => t < p.view.start || t > p.view.end;

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

  const moveHandle = (which: "start" | "end", t: number) => {
    if (which === "start") p.onRegionChange(t, p.region.end);
    else p.onRegionChange(p.region.start, t);
  };

  const handleProps = (which: "start" | "end") => ({
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
      e.stopPropagation();
      const t = which === "start" ? p.region.start : p.region.end;
      if (isOffscreen(t)) return; // dragging a pinned handle would teleport it
      dragging.current = which;
      (e.target as Element).setPointerCapture?.(e.pointerId);
    },
    onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => {
      if (dragging.current !== which) return;
      moveHandle(which, timeFromClientX(e.clientX));
    },
    onPointerUp: () => {
      dragging.current = null;
    },
    onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => {
      const base = nudgeStep();
      const step = e.shiftKey ? base * 10 : base;
      const delta = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
      if (!delta) return;
      e.preventDefault();
      moveHandle(which, (which === "start" ? p.region.start : p.region.end) + delta);
    },
  });

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

  return (
    <div className="region-timeline">
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
          onClick={() => p.onZoom(1 / ZOOM_STEP, zoomAnchor(p.view, p.currentTime))}>−</button>
        <button aria-label="zoom in" title="Zoom in"
          disabled={p.duration <= 0}
          onClick={() => p.onZoom(ZOOM_STEP, zoomAnchor(p.view, p.currentTime))}>+</button>
        <button aria-label="fit to track" title="Fit whole track"
          disabled={p.duration <= 0} onClick={p.onFit}>Fit</button>
        <button aria-label="zoom to selection" title="Zoom to selection"
          disabled={p.duration <= 0} onClick={p.onZoomToSelection}>⤢ Sel</button>
        <span className="view-span">{span > 0 ? `${span.toFixed(2)}s` : ""}</span>
      </div>
      <TimelineOverview
        duration={p.duration}
        view={p.view}
        region={p.region}
        currentTime={p.currentTime}
        onViewChange={p.onViewChange}
      />
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
          className={`region-handle start${isOffscreen(p.region.start) ? " is-offscreen" : ""}`}
          data-offscreen={isOffscreen(p.region.start) ? "true" : "false"}
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
          className={`region-handle end${isOffscreen(p.region.end) ? " is-offscreen" : ""}`}
          data-offscreen={isOffscreen(p.region.end) ? "true" : "false"}
          style={{ left: `${pct(p.region.end)}%` }}
          {...handleProps("end")}
        />
        <div className="region-playhead" style={{ left: `${pct(p.currentTime)}%` }} />
      </div>
    </div>
  );
}
