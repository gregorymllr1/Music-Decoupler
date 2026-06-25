import React from "react";

export interface TransportProps {
  playing: boolean;
  currentTime: number;
  duration: number;
  onPlayPause: () => void;
  onStop: () => void;
  onSeek: (t: number) => void;
}

function fmt(t: number): string {
  const s = Math.floor(t % 60).toString().padStart(2, "0");
  const m = Math.floor(t / 60).toString();
  return `${m}:${s}`;
}

export function Transport(p: TransportProps) {
  return (
    <div className="transport">
      <button aria-label={p.playing ? "pause" : "play"} onClick={p.onPlayPause}>
        {p.playing ? "⏸" : "▶"}
      </button>
      <button aria-label="stop" onClick={p.onStop}>⏹</button>
      <span className="time">{fmt(p.currentTime)} / {fmt(p.duration)}</span>
      <input
        type="range" min={0} max={p.duration || 0} step={0.1} value={p.currentTime}
        aria-label="seek"
        onChange={(e) => p.onSeek(Number(e.target.value))}
      />
    </div>
  );
}