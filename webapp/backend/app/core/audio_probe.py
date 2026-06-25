from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Optional, Tuple

from app.config import get_settings

ALLOWED_EXT = {"mp3", "flac", "wav", "ogg", "m4a", "aac", "aiff", "aif", "wma"}


class UploadError(Exception):
    def __init__(self, status_code: int, detail: str):
        self.status_code = status_code
        self.detail = detail
        super().__init__(detail)


def ext_of(filename: str) -> str:
    return Path(filename).suffix.lower().lstrip(".")


def validate_upload(filename: str, size_bytes: int) -> str:
    ext = ext_of(filename)
    if ext not in ALLOWED_EXT:
        raise UploadError(415, f"Unsupported file type: .{ext or '?'}")
    if size_bytes > get_settings().max_upload_bytes:
        raise UploadError(413, "File too large")
    return ext


def probe(path) -> Tuple[Optional[float], Optional[str]]:
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", str(path)],
            capture_output=True, text=True, check=True,
        ).stdout
        fmt = json.loads(out).get("format", {})
        dur = float(fmt["duration"]) if "duration" in fmt else None
        return dur, fmt.get("format_name")
    except (subprocess.CalledProcessError, FileNotFoundError, ValueError, KeyError):
        return None, None