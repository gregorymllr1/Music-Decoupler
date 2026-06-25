from __future__ import annotations

import uuid
from typing import List, Optional

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile

from app.core import jobs, paths
from app.core.audio_probe import UploadError, probe, validate_upload
from app.core.db import get_connection
from app.core.schemas import JobCreate, JobOut

router = APIRouter(prefix="/api")


@router.post("/jobs", response_model=JobOut)
async def create_job_route(
    file: UploadFile = File(...),
    model: str = Form("htdemucs"),
    output_format: str = Form("wav"),
    output_bitrate: Optional[int] = Form(320),
    output_bitdepth: Optional[int] = Form(16),
    stems: Optional[str] = Form(None),
    batch_id: Optional[str] = Form(None),
):
    data = await file.read()
    try:
        ext = validate_upload(file.filename or "upload", len(data))
    except UploadError as e:
        raise HTTPException(e.status_code, e.detail)

    jid = uuid.uuid4().hex
    dest = paths.ensure_parent(paths.upload_path(jid, ext))
    dest.write_bytes(data)
    duration, fmt = probe(dest)

    spec = JobCreate(
        model=model,
        output_format=output_format,
        output_bitrate=output_bitrate,
        output_bitdepth=output_bitdepth,
        requested_stems=[s for s in stems.split(",") if s] if stems else None,
        batch_id=batch_id,
    )
    conn = get_connection()
    try:
        return jobs.create_job(
            conn, job_id=jid, source_filename=file.filename or "upload",
            source_path=str(dest), source_format=fmt or ext,
            source_duration=duration, source_bytes=len(data), spec=spec,
        )
    finally:
        conn.close()


@router.get("/jobs", response_model=List[JobOut])
def list_jobs_route(
    status: Optional[str] = Query(None),
    batch_id: Optional[str] = Query(None),
    limit: int = Query(100), offset: int = Query(0),
):
    conn = get_connection()
    try:
        return jobs.list_jobs(conn, status=status, batch_id=batch_id, limit=limit, offset=offset)
    finally:
        conn.close()


@router.get("/jobs/{jid}", response_model=JobOut)
def get_job_route(jid: str):
    conn = get_connection()
    try:
        job = jobs.get_job(conn, jid)
        if not job:
            raise HTTPException(404, "Job not found")
        return job
    finally:
        conn.close()


@router.post("/jobs/{jid}/cancel", response_model=JobOut)
def cancel_job_route(jid: str):
    conn = get_connection()
    try:
        if not jobs.cancel_job(conn, jid):
            raise HTTPException(409, "Job is not cancelable (already running or finished)")
        return jobs.get_job(conn, jid)
    finally:
        conn.close()


@router.delete("/jobs/{jid}")
def delete_job_route(jid: str):
    conn = get_connection()
    try:
        return {"deleted": jobs.delete_job(conn, jid)}
    finally:
        conn.close()