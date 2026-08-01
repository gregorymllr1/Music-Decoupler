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
