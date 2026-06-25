import React, { useEffect, useMemo, useState } from "react";
import { createJob, listModels } from "../api/client";
import type { Job, ModelInfo, OutputFormat } from "../types";

export function Upload({ onCreated }: { onCreated: (j: Job) => void }) {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [model, setModel] = useState("htdemucs");
  const [format, setFormat] = useState<OutputFormat>("wav");
  const [bitrate, setBitrate] = useState(320);
  const [bitdepth, setBitdepth] = useState(16);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

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
    if (!file) return;
    setBusy(true);
    try {
      const chosen = stems.filter((s) => selected[s]);
      const allChosen = chosen.length === stems.length;
      onCreated(
        await createJob(file, {
          model,
          output_format: format,
          output_bitrate: format === "mp3" ? bitrate : undefined,
          output_bitdepth: format === "wav" ? bitdepth : undefined,
          stems: allChosen ? undefined : chosen,
        }),
      );
      setFile(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="upload">
      <input
        data-testid="file-input"
        type="file"
        accept=".mp3,.flac,.wav,.ogg,.m4a"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />
      <select value={model} onChange={(e) => setModel(e.target.value)}>
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
      <button onClick={submit} disabled={!file || busy}>Separate</button>
    </div>
  );
}