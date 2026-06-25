from __future__ import annotations

from pathlib import Path

import soundfile as sf
import torch

import demucs.api
from app.core import paths


def save_stem(wav: torch.Tensor, path, samplerate: int, fmt: str,
              bitrate: int = 320, bitdepth: int = 16) -> None:
    path = Path(path)
    paths.ensure_parent(path)
    if fmt == "wav":
        demucs.api.save_audio(
            wav, str(path), samplerate=samplerate,
            bits_per_sample=24 if bitdepth == 24 else 16,
            as_float=(bitdepth == 32),
        )
    elif fmt == "mp3":
        demucs.api.save_audio(wav, str(path), samplerate=samplerate, bitrate=bitrate)
    elif fmt == "flac":
        # soundfile expects (frames, channels)
        sf.write(str(path), wav.t().cpu().numpy(), samplerate, format="FLAC")
    else:
        raise ValueError(f"Unsupported output format: {fmt}")