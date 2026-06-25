import React, { useEffect } from "react";
import { Upload } from "./screens/Upload";
import { Dashboard } from "./screens/Dashboard";
import { useStore } from "./store";
import { subscribeJob } from "./api/sse";
import { getJob } from "./api/client";

export function App() {
  const jobs = useStore((s) => s.jobs);
  const upsertJob = useStore((s) => s.upsertJob);
  const setProgress = useStore((s) => s.setProgress);

  useEffect(() => {
    const unsubs = jobs
      .filter((j) => j.status === "queued" || j.status === "running")
      .map((j) =>
        subscribeJob(j.id, {
          onProgress: (d) => setProgress(j.id, d.progress, d.stage, d.device),
          onDone: async () => upsertJob(await getJob(j.id)),
          onError: async () => upsertJob(await getJob(j.id)),
        }),
      );
    return () => unsubs.forEach((u) => u());
  }, [jobs.map((j) => `${j.id}:${j.status}`).join(",")]);

  return (
    <div className="app">
      <h1>Demucs Stem Studio</h1>
      <Upload onCreated={upsertJob} />
      <Dashboard jobs={jobs} />
    </div>
  );
}