import sys
import types

from app.worker import engine


def test_detect_device_prefers_cuda(monkeypatch):
    fake_torch = types.SimpleNamespace(cuda=types.SimpleNamespace(is_available=lambda: True))
    monkeypatch.setitem(sys.modules, "torch", fake_torch)
    assert engine.detect_device() == "cuda"
    fake_torch.cuda.is_available = lambda: False
    assert engine.detect_device() == "cpu"


def test_model_cache_lru_evicts(monkeypatch):
    loaded = []

    def fake_loader(name, device):
        loaded.append(name)
        return f"sep:{name}:{device}"

    cache = engine.ModelCache(maxsize=2, loader=fake_loader)
    cache.get("a", "cpu")
    cache.get("b", "cpu")
    cache.get("a", "cpu")          # hit, no reload
    cache.get("c", "cpu")          # evicts b (LRU)
    cache.get("b", "cpu")          # reload b
    assert loaded == ["a", "b", "c", "b"]


import pytest
from pathlib import Path


@pytest.mark.integration
def test_run_separation_on_clip(tmp_path):
    pytest.importorskip("torch")
    pytest.importorskip("demucs.api")
    clip = Path(__file__).parent / "fixtures" / "clip.wav"
    if not clip.exists():
        pytest.skip("run fixtures/make_clip.py first")
    seen = []
    stems, sr = engine.run_separation(
        source_path=str(clip), model="htdemucs", device="cpu",
        on_progress=lambda f, s: seen.append(f), cache=engine.ModelCache(1),
    )
    assert set(stems.keys()) == {"drums", "bass", "other", "vocals"}
    assert sr == 44100 and seen and seen[-1] <= 1.0