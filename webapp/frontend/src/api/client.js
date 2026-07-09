const BASE = "/api";
async function json(res) {
    if (!res.ok)
        throw new Error(`${res.status}: ${await res.text()}`);
    return res.json();
}
export async function health() {
    return json(await fetch(`${BASE}/health`));
}
export async function listModels() {
    return json(await fetch(`${BASE}/models`));
}
export async function createJob(file, opts) {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("model", opts.model);
    fd.append("output_format", opts.output_format);
    if (opts.output_bitrate != null)
        fd.append("output_bitrate", String(opts.output_bitrate));
    if (opts.output_bitdepth != null)
        fd.append("output_bitdepth", String(opts.output_bitdepth));
    if (opts.stems?.length)
        fd.append("stems", opts.stems.join(","));
    if (opts.batch_id)
        fd.append("batch_id", opts.batch_id);
    return json(await fetch(`${BASE}/jobs`, { method: "POST", body: fd }));
}
export async function listJobs(params) {
    const q = new URLSearchParams(params).toString();
    return json(await fetch(`${BASE}/jobs${q ? `?${q}` : ""}`));
}
export async function getJob(id) {
    return json(await fetch(`${BASE}/jobs/${id}`));
}
export async function deleteJob(id) {
    return json(await fetch(`${BASE}/jobs/${id}`, { method: "DELETE" }));
}
export async function cancelJob(id) {
    return json(await fetch(`${BASE}/jobs/${id}/cancel`, { method: "POST" }));
}
export function stemUrl(id, stem) {
    return `${BASE}/jobs/${id}/stems/${stem}`;
}
export async function createMixdown(jobId, req) {
    return json(await fetch(`${BASE}/jobs/${jobId}/mixdown`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req),
    }));
}
export function mixdownDownloadUrl(mid) {
    return `${BASE}/mixdowns/${mid}/download`;
}
export function sourceUrl(jobId) {
    return `${BASE}/jobs/${jobId}/source`;
}
