from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Optional

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="STUDIO_", env_file=".env", protected_namespaces=()
    )

    data_dir: Path = Path("data")
    max_upload_bytes: int = 200 * 1024 * 1024
    default_model: str = "htdemucs"
    default_output_format: str = "wav"
    port: int = 8000
    max_attempts: int = 1
    model_cache_size: int = 2
    sse_poll_interval: float = 0.4
    worker_poll_interval: float = 0.5
    frontend_dist: Optional[Path] = None


@lru_cache
def get_settings() -> Settings:
    return Settings()
