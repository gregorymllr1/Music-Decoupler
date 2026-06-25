import React from "react";

export function ABToggle({ mode, onMode }: { mode: "original" | "mix"; onMode: (m: "original" | "mix") => void }) {
  return (
    <div className="ab-toggle" role="group" aria-label="A/B comparison">
      <button aria-pressed={mode === "original"} onClick={() => onMode("original")}>Original</button>
      <button aria-pressed={mode === "mix"} onClick={() => onMode("mix")}>Mix</button>
    </div>
  );
}