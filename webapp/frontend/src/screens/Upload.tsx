import React, { useEffect, useState } from "react";
import { createJob, listModels } from "../api/client";
import type { Job, ModelInfo, OutputFormat } from "../types";

export function Upload({ onCreated }: { onCreated: (j: Job) => void }) {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [model, setModel] = useState("htdemucs");
  const [format, setFormat] = useState<OutputFormat>("wav");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    listModels().then(setModels).catch(() => setModels([]));
  }, []);

  async function submit() {
    if (!file) return;
    setBusy(true);
    try {
      onCreated(await createJob(file, { model, output_format: format }));
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
      <button onClick={submit} disabled={!file || busy}>Separate</button>
    </div>
  );
}