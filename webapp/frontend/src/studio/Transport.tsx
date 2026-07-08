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
