import { create } from "zustand";
export const useStore = create((set) => ({
    jobs: [],
    upsertJob: (j) => set((s) => {
        const i = s.jobs.findIndex((x) => x.id === j.id);
        if (i === -1)
            return { jobs: [j, ...s.jobs] };
        const jobs = [...s.jobs];
        jobs[i] = { ...jobs[i], ...j };
        return { jobs };
    }),
    setProgress: (id, progress, stage, device) => set((s) => ({
        jobs: s.jobs.map((j) => j.id === id ? { ...j, progress, progress_stage: stage, device_used: device, status: "running" } : j),
    })),
}));
