import React, { useEffect, useState } from "react";
import { Upload } from "./screens/Upload";
import { Dashboard } from "./screens/Dashboard";
import { Studio } from "./screens/Studio";
import { Library } from "./screens/Library";
import { useStore } from "./store";
import { subscribeJob } from "./api/sse";
import { getJob, listJobs, deleteJob } from "./api/client";
import type { Job } from "./types";

export function App() {
  const jobs = useStore((s) => s.jobs);
  const upsertJob = useStore((s) => s.upsertJob);
  const setProgress = useStore((s) => s.setProgress);
  const [openJob, setOpenJob] = useState<Job | null>(null);
  const [view, setView] = useState<"home" | "library">("home");

  useEffect(() => {
    listJobs().then((all) => all.forEach(upsertJob)).catch(() => {});
  }, []);

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

  async function handleDelete(id: string) {
    await deleteJob(id);
    useStore.setState((s) => ({ jobs: s.jobs.filter((j) => j.id !== id) }));
  }

  if (openJob) {
    const fresh = jobs.find((j) => j.id === openJob.id) ?? openJob;
    return <Studio job={fresh} onBack={() => setOpenJob(null)} />;
  }

  return (
    <div className="app">
      <h1>Demucs Stem Studio</h1>
      <nav>
        <button onClick={() => setView("home")}>Home</button>
        <button onClick={() => setView("library")}>Library</button>
      </nav>
      {view === "library"
        ? <Library jobs={jobs} onOpen={setOpenJob} onDelete={handleDelete} />
        : (<><Upload onCreated={upsertJob} /><Dashboard jobs={jobs} onOpen={setOpenJob} /></>)}
    </div>
  );
}