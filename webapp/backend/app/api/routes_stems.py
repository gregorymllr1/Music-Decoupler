from __future__ import annotations

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from app.config import get_settings
from app.core import jobs
from app.core.db import get_connection

router = APIRouter(prefix="/api")


@router.get("/jobs/{jid}/stems/{stem}")
def get_stem(jid: str, stem: str):
    conn = get_connection()
    try:
        job = jobs.get_job(conn, jid)
    finally:
        conn.close()
    if not job or not job.stems or stem not in job.stems:
        raise HTTPException(404, "Stem not found")
    full = get_settings().data_dir / job.stems[stem]
    if not full.exists():
        raise HTTPException(404, "Stem file missing")
    return FileResponse(str(full), filename=full.name)


@router.get("/jobs/{jid}/source")
def get_source(jid: str):
    conn = get_connection()
    try:
        job = jobs.get_job(conn, jid)
    finally:
        conn.close()
    if not job or not job.source_path:
        raise HTTPException(404, "Source not found")
    from pathlib import Path

    p = Path(job.source_path)
    if not p.exists():
        raise HTTPException(404, "Source file missing")
    return FileResponse(str(p), filename=p.name)