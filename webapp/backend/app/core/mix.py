from __future__ import annotations

from pathlib import Path
from typing import Callable, List, Tuple

import numpy as np
import soundfile as sf

from app.core import paths


def load_audio(path) -> Tuple[np.ndarray, int]:
    data, sr = sf.read(str(path), always_2d=True, dtype="float32")  # frames x channels
    return data, sr


def _pad(a: np.ndarray, n: int) -> np.ndarray:
    if a.shape[0] >= n:
        return a[:n]
    return np.pad(a, ((0, n - a.shape[0]), (0, 0)))


def mix_tracks(tracks: List, resolve_path: Callable) -> Tuple[np.ndarray, int]:
    mix: np.ndarray | None = None
    sr = None
    channels = 2
    for t in tracks:
        if t.muted or t.gain == 0:
            continue
        data, s = load_audio(resolve_path(t.stem))
        sr = sr or s
        channels = data.shape[1]
        data = data * float(t.gain)
        if mix is None:
            mix = data
        else:
            n = max(mix.shape[0], data.shape[0])
            mix = _pad(mix, n) + _pad(data, n)
    if mix is None:
        sr = sr or 44100
        mix = np.zeros((1, channels), dtype="float32")
    peak = float(np.max(np.abs(mix))) if mix.size else 0.0
    if peak > 1.0:
        mix = mix / peak
    return mix.astype("float32"), sr


def write_audio(mix: np.ndarray, sr: int, path, fmt: str,
                bitrate: int = 320, bitdepth: int = 16) -> None:
    path = Path(path)
    paths.ensure_parent(path)
    if fmt == "wav":
        subtype = {16: "PCM_16", 24: "PCM_24", 32: "FLOAT"}.get(bitdepth, "PCM_16")
        sf.write(str(path), mix, sr, subtype=subtype)
    elif fmt == "flac":
        sf.write(str(path), mix, sr, format="FLAC")
    elif fmt == "mp3":
        import lameenc

        ints = np.clip(mix, -1.0, 1.0)
        ints = (ints * 32767).astype("<i2")
        enc = lameenc.Encoder()
        enc.set_bit_rate(bitrate)
        enc.set_in_sample_rate(sr)
        enc.set_channels(mix.shape[1])
        enc.set_quality(2)
        data = enc.encode(ints.tobytes()) + enc.flush()
        path.write_bytes(data)
    else:
        raise ValueError(f"Unsupported format: {fmt}")


def _slice_range(mix: np.ndarray, sr: int,
                 start_sec: float | None, end_sec: float | None) -> np.ndarray:
    begin = int(start_sec * sr) if start_sec is not None else 0
    stop = int(end_sec * sr) if end_sec is not None else mix.shape[0]
    begin = max(0, min(begin, mix.shape[0]))
    stop = max(begin, min(stop, mix.shape[0]))
    out = mix[begin:stop]
    if out.shape[0] == 0:
        return np.zeros((1, mix.shape[1]), dtype="float32")
    return out


def render_mixdown(tracks: List, resolve_path: Callable, out_path, fmt: str,
                   bitrate: int = 320, bitdepth: int = 16,
                   start_sec: float | None = None, end_sec: float | None = None) -> Path:
    mix, sr = mix_tracks(tracks, resolve_path)
    mix = _slice_range(mix, sr, start_sec, end_sec)
    write_audio(mix, sr, out_path, fmt, bitrate, bitdepth)
    return Path(out_path)
