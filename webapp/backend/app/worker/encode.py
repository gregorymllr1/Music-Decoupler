from __future__ import annotations

from pathlib import Path

import soundfile as sf
import torch

import demucs.api
from app.core import paths

_WAV_SUBTYPE = {16: "PCM_16", 24: "PCM_24", 32: "FLOAT"}


def save_stem(wav: torch.Tensor, path, samplerate: int, fmt: str,
              bitrate: int = 320, bitdepth: int = 16) -> None:
    path = Path(path)
    paths.ensure_parent(path)
    if fmt == "wav":
        # soundfile writes WAV without requiring FFmpeg/torchcodec
        subtype = _WAV_SUBTYPE.get(bitdepth, "PCM_16")
        sf.write(str(path), wav.t().cpu().numpy(), samplerate,
                 subtype=subtype, format="WAV")
    elif fmt == "mp3":
        demucs.api.save_audio(wav, str(path), samplerate=samplerate, bitrate=bitrate)
    elif fmt == "flac":
        # soundfile expects (frames, channels)
        sf.write(str(path), wav.t().cpu().numpy(), samplerate, format="FLAC")
    else:
        raise ValueError(f"Unsupported output format: {fmt}")