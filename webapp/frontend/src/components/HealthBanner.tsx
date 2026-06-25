import React, { useEffect, useState } from "react";
import { health } from "../api/client";

export function HealthBanner() {
  const [warnings, setWarnings] = useState<string[]>([]);
  useEffect(() => {
    health()
      .then((h) => {
        const w: string[] = [];
        if (!h.ffmpeg) w.push("ffmpeg not found on PATH — audio decoding will fail. Install ffmpeg.");
        if (!h.worker_alive) w.push("Worker is offline — start it with `python -m app.worker`.");
        setWarnings(w);
      })
      .catch(() => setWarnings(["Cannot reach the backend API."]));
  }, []);
  if (warnings.length === 0) return null;
  return (
    <div className="health-banner" role="alert">
      {warnings.map((w) => <div key={w}>⚠ {w}</div>)}
    </div>
  );
}