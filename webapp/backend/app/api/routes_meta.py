from __future__ import annotations

import shutil
from datetime import datetime, timezone
from typing import List

from fastapi import APIRouter

from app.config import get_settings
from app.core import jobs
from app.core.db import get_connection
from app.core.schemas import HealthOut, ModelInfo

router = APIRouter(prefix="/api")

MODELS = [
    ModelInfo(name="htdemucs", stems=["drums", "bass", "other", "vocals"],
              description="Default Hybrid Transformer Demucs (fast, 4 stems)."),
    ModelInfo(name="htdemucs_ft", stems=["drums", "bass", "other", "vocals"],
              description="Fine-tuned htdemucs (~4x slower, slightly better)."),
    ModelInfo(name="htdemucs_6s", stems=["drums", "bass", "other", "vocals", "guitar", "piano"],
              description="6 stems incl. guitar/piano (piano stem is weak)."),
    ModelInfo(name="hdemucs_mmi", stems=["drums", "bass", "other", "vocals"],
              description="Hybrid Demucs v3 retrained."),
    ModelInfo(name="mdx_extra", stems=["drums", "bass", "other", "vocals"],
              description="MDX extra-trained alternative."),
]


def _worker_alive(conn) -> bool:
    hb = jobs.get_meta(conn, "worker_heartbeat")
    if not hb:
        return False
    try:
        last = datetime.fromisoformat(hb)
    except ValueError:
        return False
    return (datetime.now(timezone.utc) - last).total_seconds() < 15


@router.get("/health", response_model=HealthOut)
def health() -> HealthOut:
    conn = get_connection()
    try:
        db_ok = conn.execute("SELECT 1").fetchone() is not None
        return HealthOut(
            db=db_ok,
            ffmpeg=shutil.which("ffmpeg") is not None,
            worker_alive=_worker_alive(conn),
            device=jobs.get_meta(conn, "device"),
        )
    finally:
        conn.close()


@router.get("/models", response_model=List[ModelInfo])
def models() -> List[ModelInfo]:
    return MODELS