import React, { useMemo, useState } from "react";
import type { Job } from "../types";

export function Library({
  jobs, onOpen, onDelete,
}: {
  jobs: Job[];
  onOpen: (j: Job) => void;
  onDelete: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const filtered = useMemo(
    () => jobs.filter((j) => j.source_filename.toLowerCase().includes(q.toLowerCase())),
    [jobs, q],
  );
  return (
    <div className="library">
      <input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
      <ul>
        {filtered.map((j) => (
          <li key={j.id}>
            <span className="name">{j.source_filename}</span>
            <span className="meta">{j.model} · {j.status}</span>
            {j.status === "done" && <button onClick={() => onOpen(j)}>Open</button>}
            <button onClick={() => onDelete(j.id)}>Delete</button>
          </li>
        ))}
      </ul>
    </div>
  );
}