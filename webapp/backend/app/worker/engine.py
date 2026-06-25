from __future__ import annotations

from collections import OrderedDict
from typing import Callable, Dict, Optional, Tuple

from app.worker.progress import compute_progress


def detect_device() -> str:
    import torch

    return "cuda" if torch.cuda.is_available() else "cpu"


def _default_loader(model_name: str, device: str):
    import demucs.api

    return demucs.api.Separator(model=model_name, device=device)


class ModelCache:
    def __init__(self, maxsize: int = 2, loader: Optional[Callable] = None):
        self.maxsize = maxsize
        self.loader = loader or _default_loader
        self._items: "OrderedDict[tuple, object]" = OrderedDict()

    def get(self, model_name: str, device: str):
        key = (model_name, device)
        if key in self._items:
            self._items.move_to_end(key)
            return self._items[key]
        sep = self.loader(model_name, device)
        self._items[key] = sep
        self._items.move_to_end(key)
        while len(self._items) > self.maxsize:
            self._items.popitem(last=False)
        return sep


def run_separation(*, source_path: str, model: str, device: str,
                   on_progress: Callable[[float, str], None],
                   cache: ModelCache) -> Tuple[Dict[str, object], int]:
    separator = cache.get(model, device)

    def _cb(d: dict) -> None:
        if d.get("state") == "end":
            frac, stage = compute_progress(d)
            on_progress(frac, stage)

    separator.update_parameter(callback=_cb)
    _origin, separated = separator.separate_audio_file(source_path)
    return separated, separator.samplerate


def _is_oom(err: Exception) -> bool:
    return "out of memory" in str(err).lower()


def _empty_cuda_cache() -> None:
    try:
        import torch

        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except Exception:
        pass


def run_separation_resilient(*, source_path, model, device, on_progress, cache,
                             segments=(None, 12, 8)):
    devices = [device, "cpu"] if device == "cuda" else ["cpu"]
    last_err = None
    for dev in devices:
        seg_list = segments if dev == "cuda" else (None,)
        for seg in seg_list:
            separator = cache.get(model, dev)

            def _cb(d: dict) -> None:
                if d.get("state") == "end":
                    frac, stage = compute_progress(d)
                    on_progress(frac, stage)

            kwargs = {"callback": _cb}
            if seg is not None:
                kwargs["segment"] = seg
            separator.update_parameter(**kwargs)
            try:
                _origin, separated = separator.separate_audio_file(source_path)
                return separated, separator.samplerate, dev
            except RuntimeError as e:  # noqa: PERF203
                last_err = e
                if not _is_oom(e):
                    raise
                _empty_cuda_cache()
    raise RuntimeError(f"Separation failed after OOM fallbacks: {last_err}")