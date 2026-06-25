from __future__ import annotations

from pathlib import Path

from app.config import get_settings


def _root() -> Path:
    return get_settings().data_dir


def job_upload_dir(job_id: str) -> Path:
    return _root() / "uploads" / job_id


def upload_path(job_id: str, ext: str) -> Path:
    return job_upload_dir(job_id) / f"source.{ext.lstrip('.')}"


def stems_dir(job_id: str) -> Path:
    return _root() / "stems" / job_id


def stem_path(job_id: str, stem: str, ext: str) -> Path:
    return stems_dir(job_id) / f"{stem}.{ext.lstrip('.')}"


def mixdowns_dir(job_id: str) -> Path:
    return _root() / "mixdowns" / job_id


def mixdown_path(job_id: str, mixdown_id: str, ext: str) -> Path:
    return mixdowns_dir(job_id) / f"{mixdown_id}.{ext.lstrip('.')}"


def ensure_parent(p: Path) -> Path:
    p.parent.mkdir(parents=True, exist_ok=True)
    return p