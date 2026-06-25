import React, { useState } from "react";
import type { OutputFormat } from "../types";

export function ExportPanel({ onExport }: { onExport: (format: OutputFormat, name: string) => void }) {
  const [format, setFormat] = useState<OutputFormat>("mp3");
  const [name, setName] = useState("mixdown");
  return (
    <div className="export-panel">
      <label>
        Name
        <input aria-label="name" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        Format
        <select aria-label="format" value={format} onChange={(e) => setFormat(e.target.value as OutputFormat)}>
          <option value="mp3">MP3</option>
          <option value="flac">FLAC</option>
          <option value="wav">WAV</option>
        </select>
      </label>
      <button onClick={() => onExport(format, name)}>Export mixdown</button>
    </div>
  );
}