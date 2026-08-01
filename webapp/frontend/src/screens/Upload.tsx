import React, { useEffect, useMemo, useRef, useState } from "react";
import { createJob, listModels } from "../api/client";
import type { Job, ModelInfo, OutputFormat } from "../types";

type PresetName = "fast" | "high" | "max";

// Multipliers measured on this machine (CPU-only, 15s clip of test.mp3):
// Fast 10.6s, High 36.2s (~3x), Max 92.4s (~9x); Max extrapolates to ~25 min
// for a 4-minute song, within the ~30 min budget.
export const PRESETS: Record<
  PresetName,
  { model: string; shifts: number; overlap: number; label: string }
> = {
  fast: { model: "htdemucs", shifts: 1, overlap: 0.25, label: "Fast (~1x)" },
  high: { model: "htdemucs_ft", shifts: 1, overlap: 0.25, label: "High quality (~3x)" },
  max: { model: "htdemucs_ft", shifts: 2, overlap: 0.5, label: "Max quality (~9x)" },
};

export function Upload({ onCreated }: { onCreated: (j: Job) => void }) {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [preset, setPreset] = useState<PresetName>("high");
  const [model, setModel] = useState(PRESETS.high.model);
  const [format, setFormat] = useState<OutputFormat>("wav");
  const [bitrate, setBitrate] = useState(320);
  const [bitdepth, setBitdepth] = useState(16);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    listModels().then(setModels).catch(() => setModels([]));
  }, []);

  const stems = useMemo(
    () => models.find((m) => m.name === model)?.stems ?? [],
    [models, model],
  );

  useEffect(() => {
    setSelected(Object.fromEntries(stems.map((s) => [s, true])));
  }, [stems.join(",")]);

  async function submit() {
    if (files.length === 0) return;
    setBusy(true);
    try {
      const chosen = stems.filter((s) => selected[s]);
      const allChosen = chosen.length === stems.length;
      const batch_id = files.length > 1 ? crypto.randomUUID() : undefined;
      for (const f of files) {
        onCreated(
          await createJob(f, {
            model,
            output_format: format,
            output_bitrate: format === "mp3" ? bitrate : undefined,
            output_bitdepth: format === "wav" ? bitdepth : undefined,
            shifts: PRESETS[preset].shifts,
            overlap: PRESETS[preset].overlap,
            stems: allChosen ? undefined : chosen,
            batch_id,
          }),
        );
      }
      setFiles([]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="upload">
      <div className="upload-pick-row">
        <input
          ref={inputRef}
          data-testid="file-input"
          type="file"
          multiple
          accept=".mp3,.flac,.wav,.ogg,.m4a"
          onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
          style={{ display: "none" }}
        />
        <button
          type="button"
          className="btn-load-track"
          onClick={() => inputRef.current?.click()}
        >
          Load Track
        </button>
        <span className="upload-picked">
          {files.length === 0
            ? "No tracks selected"
            : files.length === 1
              ? files[0].name
              : `${files.length} tracks selected`}
        </span>
      </div>
      <select
        aria-label="quality"
        value={preset}
        onChange={(e) => {
          const p = e.target.value as PresetName;
          setPreset(p);
          setModel(PRESETS[p].model);
        }}
      >
        {(Object.keys(PRESETS) as PresetName[]).map((p) => (
          <option key={p} value={p}>{PRESETS[p].label}</option>
        ))}
      </select>
      <select aria-label="model" value={model} onChange={(e) => setModel(e.target.value)}>
        {models.map((m) => (
          <option key={m.name} value={m.name}>{m.name}</option>
        ))}
      </select>
      <select value={format} onChange={(e) => setFormat(e.target.value as OutputFormat)}>
        <option value="wav">WAV</option>
        <option value="flac">FLAC</option>
        <option value="mp3">MP3</option>
      </select>
      {format === "mp3" && (
        <select value={bitrate} onChange={(e) => setBitrate(Number(e.target.value))}>
          {[128, 192, 256, 320].map((b) => <option key={b} value={b}>{b} kbps</option>)}
        </select>
      )}
      {format === "wav" && (
        <select value={bitdepth} onChange={(e) => setBitdepth(Number(e.target.value))}>
          <option value={16}>16-bit</option>
          <option value={24}>24-bit</option>
          <option value={32}>32-bit float</option>
        </select>
      )}
      <fieldset className="stems">
        {stems.map((s) => (
          <label key={s}>
            <input
              type="checkbox"
              aria-label={s}
              checked={selected[s] ?? true}
              onChange={(e) => setSelected((p) => ({ ...p, [s]: e.target.checked }))}
            />
            {s}
          </label>
        ))}
      </fieldset>
      <button className="btn-primary" onClick={submit} disabled={files.length === 0 || busy}>
        {files.length > 1 ? `Separate ${files.length} files` : "Separate"}
      </button>
    </div>
  );
}
