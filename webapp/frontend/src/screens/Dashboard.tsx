import React from "react";
import type { Job } from "../types";
import { stemUrl } from "../api/client";

function groupByBatch(jobs: Job[]): { batch?: string; jobs: Job[] }[] {
  const groups = new Map<string, Job[]>();
  const singles: Job[] = [];
  for (const j of jobs) {
    if (j.batch_id) groups.set(j.batch_id, [...(groups.get(j.batch_id) ?? []), j]);
    else singles.push(j);
  }
  return [
    ...[...groups.entries()].map(([batch, jobs]) => ({ batch, jobs })),
    ...singles.map((j) => ({ jobs: [j] })),
  ];
}

function JobCard({ j, onOpen }: { j: Job; onOpen?: (j: Job) => void }) {
  return (
    <div className="job-card">
      <div className="job-head">
        <strong>{j.source_filename}</strong>
        <span className="status">{j.status}</span>
        {j.device_used && <span className="device">{j.device_used}</span>}
      </div>
      <div className="progress-track">
        <div
          data-testid={`progress-${j.id}`}
          className="progress-fill"
          style={{ width: `${Math.round(j.progress * 100)}%` }}
        />
      </div>
      {j.status === "done" && j.stems && (
        <div className="downloads">
          {Object.keys(j.stems).map((stem) => (
            <a key={stem} href={stemUrl(j.id, stem)} download>
              {stem}
            </a>
          ))}
        </div>
      )}
      {j.status === "done" && onOpen && (
        <button onClick={() => onOpen(j)}>Open in studio</button>
      )}
      {j.status === "failed" && <div className="error">{j.error_message}</div>}
    </div>
  );
}

export function Dashboard({ jobs, onOpen }: { jobs: Job[]; onOpen?: (j: Job) => void }) {
  const groups = groupByBatch(jobs);
  return (
    <div>
      {groups.map((g, gi) => (
        <div key={g.batch ?? `single-${gi}`}>
          {g.batch && <div className="batch-head">Batch ({g.jobs.length})</div>}
          {g.jobs.map((j) => (
            <JobCard key={j.id} j={j} onOpen={onOpen} />
          ))}
        </div>
      ))}
    </div>
  );
}