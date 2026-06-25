import React from "react";
import type { Job } from "../types";
import { useStudioEngine } from "../studio/useStudioEngine";
import { ChannelStrip } from "../studio/ChannelStrip";
import { Transport } from "../studio/Transport";
import { Waveform } from "../studio/Waveform";
import { ABToggle } from "../studio/ABToggle";
import { ExportPanel } from "../studio/ExportPanel";
import { stemUrl, createMixdown, mixdownDownloadUrl } from "../api/client";

export function Studio({ job, onBack }: { job: Job; onBack: () => void }) {
  const s = useStudioEngine(job);

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
      <div className="tracks">
        {s.channels.map((c) => (
          <div className="track-row" key={c.stem}>
            <ChannelStrip
              stem={c.stem} label={c.stem} volume={c.volume} muted={c.muted} solo={c.solo}
              onVolume={(v) => s.setGain(c.stem, v)}
              onMute={(b) => s.setMute(c.stem, b)}
              onSolo={(b) => s.setSolo(c.stem, b)}
            />
            <Waveform url={stemUrl(job.id, c.stem)} />
          </div>
        ))}
      </div>
      <Transport
        playing={s.transport.playing}
        currentTime={s.transport.currentTime}
        duration={s.transport.duration}
        onPlayPause={() => (s.transport.playing ? s.pause() : s.play())}
        onStop={s.stop}
        onSeek={s.seek}
      />
      <label className="master">
        Master
        <input type="range" min={0} max={1.5} step={0.01} value={s.master}
          onChange={(e) => s.setMaster(Number(e.target.value))} />
      </label>
      <ExportPanel onExport={handleExport} />
    </div>
  );
}