from __future__ import annotations

from typing import Tuple


def compute_progress(d: dict) -> Tuple[float, str]:
    models = max(int(d.get("models", 1)), 1)
    model_idx = int(d.get("model_idx_in_bag", 0))
    audio_length = float(d.get("audio_length", 0) or 0)
    segment_offset = float(d.get("segment_offset", 0) or 0)

    seg_frac = (segment_offset / audio_length) if audio_length > 0 else 0.0
    seg_frac = min(max(seg_frac, 0.0), 1.0)
    frac = (model_idx + seg_frac) / models
    frac = min(max(frac, 0.0), 1.0)
    return frac, f"model {model_idx + 1}/{models}"