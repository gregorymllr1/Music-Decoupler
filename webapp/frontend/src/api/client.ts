import type { CreateJobOpts, Job, ModelInfo, MixdownRequest } from "../types";

const BASE = "/api";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export async function health() {
  return json<{ db: boolean; ffmpeg: boolean; worker_alive: boolean; device?: string }>(
    await fetch(`${BASE}/health`),
  );
}

export async function listModels(): Promise<ModelInfo[]> {
  return json(await fetch(`${BASE}/models`));
}

export async function createJob(file: File, opts: CreateJobOpts): Promise<Job> {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("model", opts.model);
  fd.append("output_format", opts.output_format);
  if (opts.output_bitrate != null) fd.append("output_bitrate", String(opts.output_bitrate));
  if (opts.output_bitdepth != null) fd.append("output_bitdepth", String(opts.output_bitdepth));
  if (opts.stems?.length) fd.append("stems", opts.stems.join(","));
  if (opts.batch_id) fd.append("batch_id", opts.batch_id);
  return json(await fetch(`${BASE}/jobs`, { method: "POST", body: fd }));
}

export async function listJobs(params?: { status?: string; batch_id?: string }): Promise<Job[]> {
  const q = new URLSearchParams(params as Record<string, string>).toString();
  return json(await fetch(`${BASE}/jobs${q ? `?${q}` : ""}`));
}

export async function getJob(id: string): Promise<Job> {
  return json(await fetch(`${BASE}/jobs/${id}`));
}

export async function deleteJob(id: string): Promise<{ deleted: boolean }> {
  return json(await fetch(`${BASE}/jobs/${id}`, { method: "DELETE" }));
}

export async function cancelJob(id: string): Promise<Job> {
  return json(await fetch(`${BASE}/jobs/${id}/cancel`, { method: "POST" }));
}

export function stemUrl(id: string, stem: string): string {
  return `${BASE}/jobs/${id}/stems/${stem}`;
}

export interface MixdownOut {
  id: string;
  job_id: string;
  name: string;
  format: string;
  created_at: string;
}

export async function createMixdown(jobId: string, req: MixdownRequest): Promise<MixdownOut> {
  return json(
    await fetch(`${BASE}/jobs/${jobId}/mixdown`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    }),
  );
}

export function mixdownDownloadUrl(mid: string): string {
  return `${BASE}/mixdowns/${mid}/download`;
}

export function sourceUrl(jobId: string): string {
  return `${BASE}/jobs/${jobId}/source`;
}