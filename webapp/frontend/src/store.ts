import { create } from "zustand";
import type { Job } from "./types";

interface State {
  jobs: Job[];
  upsertJob: (j: Job) => void;
  setProgress: (id: string, progress: number, stage?: string, device?: string) => void;
}

export const useStore = create<State>((set) => ({
  jobs: [],
  upsertJob: (j) =>
    set((s) => {
      const i = s.jobs.findIndex((x) => x.id === j.id);
      if (i === -1) return { jobs: [j, ...s.jobs] };
      const jobs = [...s.jobs];
      jobs[i] = { ...jobs[i], ...j };
      return { jobs };
    }),
  setProgress: (id, progress, stage, device) =>
    set((s) => ({
      jobs: s.jobs.map((j) =>
        j.id === id ? { ...j, progress, progress_stage: stage, device_used: device, status: "running" } : j,
      ),
    })),
}));