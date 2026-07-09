import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { stemUrl } from "../api/client";
function groupByBatch(jobs) {
    const groups = new Map();
    const singles = [];
    for (const j of jobs) {
        if (j.batch_id)
            groups.set(j.batch_id, [...(groups.get(j.batch_id) ?? []), j]);
        else
            singles.push(j);
    }
    return [
        ...[...groups.entries()].map(([batch, jobs]) => ({ batch, jobs })),
        ...singles.map((j) => ({ jobs: [j] })),
    ];
}
function JobCard({ j, onOpen }) {
    return (_jsxs("div", { className: "job-card", children: [_jsxs("div", { className: "job-head", children: [_jsx("strong", { children: j.source_filename }), _jsx("span", { className: "status", children: j.status }), j.device_used && _jsx("span", { className: "device", children: j.device_used })] }), _jsx("div", { className: "progress-track", children: _jsx("div", { "data-testid": `progress-${j.id}`, className: "progress-fill", style: { width: `${Math.round(j.progress * 100)}%` } }) }), j.status === "done" && j.stems && (_jsx("div", { className: "downloads", children: Object.keys(j.stems).map((stem) => (_jsx("a", { href: stemUrl(j.id, stem), download: true, children: stem }, stem))) })), j.status === "done" && onOpen && (_jsx("button", { onClick: () => onOpen(j), children: "Open in studio" })), j.status === "failed" && _jsx("div", { className: "error", children: j.error_message })] }));
}
export function Dashboard({ jobs, onOpen }) {
    const groups = groupByBatch(jobs);
    return (_jsx("div", { children: groups.map((g, gi) => (_jsxs("div", { children: [g.batch && _jsxs("div", { className: "batch-head", children: ["Batch (", g.jobs.length, ")"] }), g.jobs.map((j) => (_jsx(JobCard, { j: j, onOpen: onOpen }, j.id)))] }, g.batch ?? `single-${gi}`))) }));
}
