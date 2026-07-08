from __future__ import annotations

import json
import uuid

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from app.config import get_settings
from app.core import jobs, mix, paths
from app.core.db import get_connection
from app.core.schemas import MixdownOut, MixdownRequest

router = APIRouter(prefix="/api")


@router.post("/jobs/{jid}/mixdown", response_model=MixdownOut)
def create_mixdown_route(jid: str, req: MixdownRequest):
    conn = get_connection()
    try:
        job = jobs.get_job(conn, jid)
        if not job or job.status != "done" or not job.stems:
            raise HTTPException(404, "Finished job with stems not found")
        data_dir = get_settings().data_dir

        def resolve(stem):
            if stem not in job.stems:
                raise HTTPException(400, f"Unknown stem: {stem}")
            return data_dir / job.stems[stem]

        mid = uuid.uuid4().hex
        out = paths.mixdown_path(jid, mid, req.format)
        mix.render_mixdown([t for t in req.tracks], resolve, out, req.format,
                           bitrate=req.bitrate or 320, bitdepth=req.bitdepth or 16,
                           start_sec=req.start_sec, end_sec=req.end_sec)
        return jobs.create_mixdown(
            conn, job_id=jid, name=req.name,
            spec_json=json.dumps(req.model_dump()), path=out, fmt=req.format,
        )
    finally:
        conn.close()


@router.get("/mixdowns/{mid}/download")
def download_mixdown(mid: str):
    conn = get_connection()
    try:
        row = jobs.get_mixdown(conn, mid)
    finally:
        conn.close()
    if not row:
        raise HTTPException(404, "Mixdown not found")
    from pathlib import Path

    p = Path(row["path"])
    if not p.exists():
        raise HTTPException(404, "Mixdown file missing")
    return FileResponse(str(p), filename=f"{row['name']}.{row['format']}")