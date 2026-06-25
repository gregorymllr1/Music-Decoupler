import React from "react";
import type { Job } from "../types";
import { stemUrl } from "../api/client";

export function Dashboard({ jobs, onOpen }: { jobs: Job[]; onOpen?: (j: Job) => void }) {
  return (
    <div>
      {jobs.map((j) => (
        <div key={j.id} className="job-card">
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
      ))}
    </div>
  );
}