import React from "react";

export interface ChannelStripProps {
  stem: string;
  label: string;
  volume: number;
  muted: boolean;
  solo: boolean;
  onVolume: (v: number) => void;
  onMute: (b: boolean) => void;
  onSolo: (b: boolean) => void;
}

export function ChannelStrip(p: ChannelStripProps) {
  return (
    <div className={`channel-strip ${p.muted ? "is-muted" : ""}`}>
      <div className="channel-label">{p.label}</div>
      <div className="channel-buttons">
        <button aria-pressed={p.solo} aria-label={`solo ${p.label}`} onClick={() => p.onSolo(!p.solo)}>S</button>
        <button aria-pressed={p.muted} aria-label={`mute ${p.label}`} onClick={() => p.onMute(!p.muted)}>M</button>
      </div>
      <input
        type="range" min={0} max={1.5} step={0.01} value={p.volume}
        aria-label={`volume ${p.label}`}
        onChange={(e) => p.onVolume(Number(e.target.value))}
      />
    </div>
  );
}