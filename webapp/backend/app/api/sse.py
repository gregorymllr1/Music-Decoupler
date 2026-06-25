from __future__ import annotations

import asyncio
import json
from typing import AsyncIterator, Callable

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from app.config import get_settings
from app.core import jobs
from app.core.db import get_connection

router = APIRouter(prefix="/api")

TERMINAL = {"done", "failed", "canceled"}


def _format(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


async def job_event_stream(get_job_fn: Callable, jid: str, *, poll_interval: float,
                           sleep_fn=asyncio.sleep) -> AsyncIterator[str]:
    last = None
    while True:
        job = get_job_fn(jid)
        if job is None:
            yield _format("error", {"status": "failed", "message": "Job not found"})
            return
        snapshot = (job.status, round(job.progress, 4), job.progress_stage)
        if snapshot != last:
            last = snapshot
            if job.status in TERMINAL:
                if job.status == "done":
                    yield _format("done", {"status": "done", "stems": job.stems or {}})
                elif job.status == "failed":
                    yield _format("error", {"status": "failed", "message": job.error_message})
                else:
                    yield _format("canceled", {"status": "canceled"})
                return
            yield _format("progress", {
                "status": job.status, "progress": job.progress,
                "stage": job.progress_stage, "device": job.device_used,
            })
        await sleep_fn(poll_interval)


@router.get("/jobs/{jid}/events")
async def job_events(jid: str):
    settings = get_settings()

    def get_job_fn(job_id):
        conn = get_connection()
        try:
            return jobs.get_job(conn, job_id)
        finally:
            conn.close()

    if get_job_fn(jid) is None:
        raise HTTPException(404, "Job not found")

    return StreamingResponse(
        job_event_stream(get_job_fn, jid, poll_interval=settings.sse_poll_interval),
        media_type="text/event-stream",
    )