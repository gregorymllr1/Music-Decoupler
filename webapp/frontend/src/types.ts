export type JobStatus = "queued" | "running" | "done" | "failed" | "canceled";
export type OutputFormat = "wav" | "flac" | "mp3";

export interface Job {
  id: string;
  batch_id?: string | null;
  status: JobStatus;
  source_filename: string;
  source_duration?: number | null;
  model: string;
  output_format: OutputFormat;
  progress: number;
  progress_stage?: string | null;
  device_used?: string | null;
  stems?: Record<string, string> | null;
  error_message?: string | null;
}

export interface ModelInfo {
  name: string;
  stems: string[];
  description: string;
}

export interface CreateJobOpts {
  model: string;
  output_format: OutputFormat;
  output_bitrate?: number;
  output_bitdepth?: number;
  stems?: string[];
  batch_id?: string;
}

export interface MixdownTrack {
  stem: string;
  gain: number;
  muted: boolean;
}

export interface MixdownRequest {
  name: string;
  format: OutputFormat;
  bitrate?: number;
  bitdepth?: number;
  start_sec?: number;
  end_sec?: number;
  tracks: MixdownTrack[];
}