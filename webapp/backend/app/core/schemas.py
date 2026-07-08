from __future__ import annotations

from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, model_validator

JobStatus = Literal["queued", "running", "done", "failed", "canceled"]
OutputFormat = Literal["wav", "flac", "mp3"]


class JobCreate(BaseModel):
    model: str = "htdemucs"
    output_format: OutputFormat = "wav"
    output_bitrate: Optional[int] = 320
    output_bitdepth: Optional[int] = 16
    requested_stems: Optional[List[str]] = None
    batch_id: Optional[str] = None


class JobOut(BaseModel):
    id: str
    batch_id: Optional[str] = None
    created_at: str
    updated_at: str
    status: JobStatus
    attempts: int
    source_filename: str
    source_path: Optional[str] = None
    source_format: Optional[str] = None
    source_duration: Optional[float] = None
    source_bytes: Optional[int] = None
    model: str
    output_format: OutputFormat
    output_bitrate: Optional[int] = None
    output_bitdepth: Optional[int] = None
    requested_stems: Optional[List[str]] = None
    device_used: Optional[str] = None
    progress: float
    progress_stage: Optional[str] = None
    stems: Optional[Dict[str, str]] = None
    error_message: Optional[str] = None


class MixdownTrack(BaseModel):
    stem: str
    gain: float = 1.0
    muted: bool = False


class MixdownRequest(BaseModel):
    name: str = "mixdown"
    format: OutputFormat = "mp3"
    bitrate: Optional[int] = 320
    bitdepth: Optional[int] = 16
    start_sec: Optional[float] = None
    end_sec: Optional[float] = None
    tracks: List[MixdownTrack]

    @model_validator(mode="after")
    def _validate_range(self):
        if self.start_sec is not None and self.start_sec < 0:
            raise ValueError("start_sec must be >= 0")
        if self.end_sec is not None and self.end_sec <= (self.start_sec or 0.0):
            raise ValueError("end_sec must be greater than start_sec")
        return self


class MixdownOut(BaseModel):
    id: str
    job_id: str
    name: str
    format: OutputFormat
    created_at: str


class ModelInfo(BaseModel):
    name: str
    stems: List[str]
    description: str = ""


class HealthOut(BaseModel):
    db: bool
    ffmpeg: bool
    worker_alive: bool
    device: Optional[str] = None