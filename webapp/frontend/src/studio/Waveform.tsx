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
