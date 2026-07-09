import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { Upload } from "./screens/Upload";
import { Dashboard } from "./screens/Dashboard";
import { Studio } from "./screens/Studio";
import { Library } from "./screens/Library";
import { HealthBanner } from "./components/HealthBanner";
import { useStore } from "./store";
import { subscribeJob } from "./api/sse";
import { getJob, listJobs, deleteJob } from "./api/client";
export function App() {
    const jobs = useStore((s) => s.jobs);
    const upsertJob = useStore((s) => s.upsertJob);
    const setProgress = useStore((s) => s.setProgress);
    const [openJob, setOpenJob] = useState(null);
    const [view, setView] = useState("home");
    useEffect(() => {
        listJobs().then((all) => all.forEach(upsertJob)).catch(() => { });
    }, []);
    useEffect(() => {
        const unsubs = jobs
            .filter((j) => j.status === "queued" || j.status === "running")
            .map((j) => subscribeJob(j.id, {
            onProgress: (d) => setProgress(j.id, d.progress, d.stage, d.device),
            onDone: async () => upsertJob(await getJob(j.id)),
            onError: async () => upsertJob(await getJob(j.id)),
        }));
        return () => unsubs.forEach((u) => u());
    }, [jobs.map((j) => `${j.id}:${j.status}`).join(",")]);
    async function handleDelete(id) {
        await deleteJob(id);
        useStore.setState((s) => ({ jobs: s.jobs.filter((j) => j.id !== id) }));
    }
    if (openJob) {
        const fresh = jobs.find((j) => j.id === openJob.id) ?? openJob;
        return _jsx(Studio, { job: fresh, onBack: () => setOpenJob(null) });
    }
    return (_jsxs("div", { className: "app", children: [_jsx("h1", { children: "Instrumental Detangler" }), _jsx(HealthBanner, {}), _jsxs("nav", { children: [_jsx("button", { className: view === "home" ? "nav-active" : "", onClick: () => setView("home"), children: "Home" }), _jsx("button", { className: view === "library" ? "nav-active" : "", onClick: () => setView("library"), children: "Library" })] }), view === "library"
                ? _jsx(Library, { jobs: jobs, onOpen: setOpenJob, onDelete: handleDelete })
                : (_jsxs(_Fragment, { children: [_jsx(Upload, { onCreated: upsertJob }), _jsx(Dashboard, { jobs: jobs, onOpen: setOpenJob })] }))] }));
}
