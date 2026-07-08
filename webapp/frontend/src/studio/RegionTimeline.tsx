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
