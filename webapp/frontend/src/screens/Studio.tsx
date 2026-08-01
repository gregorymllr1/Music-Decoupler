import React, { useEffect, useRef } from "react";
import type { Job } from "../types";
import { useStudioEngine, REGION_EDGE_EPS } from "../studio/useStudioEngine";
import { useTimelineView, ZOOM_STEP, zoomAnchor } from "../studio/useTimelineView";
import { ChannelStrip } from "../studio/ChannelStrip";
import { Transport } from "../studio/Transport";
import { Waveform } from "../studio/Waveform";
import { ABToggle } from "../studio/ABToggle";
import { ExportPanel } from "../studio/ExportPanel";
import { RegionTimeline } from "../studio/RegionTimeline";
import { fmtTime } from "../studio/time";
import { createMixdown, mixdownDownloadUrl } from "../api/client";

export function Studio({ job, onBack }: { job: Job; onBack: () => void }) {
  const s = useStudioEngine(job);
  const dur = s.transport.duration;
  const v = useTimelineView(dur);
  const span = v.view.end - v.view.start;
  const pct = (t: number) =>
    span > 0 ? Math.min(100, Math.max(0, ((t - v.view.start) / span) * 100)) : 0;
  const narrowed = dur > 0 && (s.region.start > REGION_EDGE_EPS || s.region.end < dur - REGION_EDGE_EPS);
  const rangeSummary = narrowed
    ? `Selection ${fmtTime(s.region.start)} – ${fmtTime(s.region.end)} (${fmtTime(s.region.end - s.region.start)})`
    : "Full track";

  // Kept in a ref: currentTime changes every animation frame, and depending on
  // it directly would re-subscribe the listener 60x a second.
  const zoomAnchorRef = useRef(0);
  zoomAnchorRef.current = zoomAnchor(v.view, s.transport.currentTime);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || el?.isContentEditable) return;
      if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        v.zoomBy(ZOOM_STEP, zoomAnchorRef.current);
      } else if (e.key === "-") {
        e.preventDefault();
        v.zoomBy(1 / ZOOM_STEP, zoomAnchorRef.current);
      } else if (e.key === "0") {
        e.preventDefault();
        v.fit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [v.zoomBy, v.fit]);

  async function handleExport(format: "wav" | "flac" | "mp3", name: string) {
    const req = s.buildMixdownRequest(format, name);
    const out = await createMixdown(job.id, req);
    window.location.href = mixdownDownloadUrl(out.id);
  }

  return (
    <div className="studio">
      <header>
        <button onClick={onBack}>◀ Back</button>
        <strong>{job.source_filename}</strong>
        <span>{job.model} · {job.device_used ?? ""}</span>
        <ABToggle mode={s.abMode} onMode={s.setABMode} />
      </header>
      <RegionTimeline
        duration={dur}
        currentTime={s.transport.currentTime}
        region={s.region}
        view={v.view}
        onRegionChange={s.setRegion}
        onSeek={s.seek}
        onZoom={v.zoomBy}
        onFit={v.fit}
        onZoomToSelection={() => v.zoomToSelection(s.region.start, s.region.end)}
        onPan={v.panBy}
        onViewChange={v.setView}
      />
      <div className="tracks">
        {s.channels.map((c) => (
          <div className="track-row" key={c.stem}>
            <ChannelStrip
              stem={c.stem} label={c.stem} volume={c.volume} muted={c.muted} solo={c.solo}
              onVolume={(v) => s.setGain(c.stem, v)}
              onMute={(b) => s.setMute(c.stem, b)}
              onSolo={(b) => s.setSolo(c.stem, b)}
            />
            <Waveform data={s.waveforms[c.stem] ?? null} view={v.view} />
          </div>
        ))}
        <div className="tracks-overlay" aria-hidden="true">
          <div className="overlay-dim" style={{ left: 0, width: `${pct(s.region.start)}%` }} />
          <div className="overlay-dim" style={{ left: `${pct(s.region.end)}%`, right: 0 }} />
          <div className="overlay-playhead" style={{ left: `${pct(s.transport.currentTime)}%` }} />
        </div>
      </div>
      <Transport
        playing={s.transport.playing}
        currentTime={s.transport.currentTime}
        duration={s.transport.duration}
        onPlayPause={() => (s.transport.playing ? s.pause() : s.play())}
        onStop={s.stop}
        onSeek={s.seek}
        onPlaySelection={s.playSelection}
      />
      <label className="master">
        Master
        <input type="range" min={0} max={1.5} step={0.01} value={s.master}
          onChange={(e) => s.setMaster(Number(e.target.value))} />
      </label>
      <ExportPanel onExport={handleExport} rangeSummary={rangeSummary} />
    </div>
  );
}
