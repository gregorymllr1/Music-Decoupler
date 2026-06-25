import pytest

from app.worker import engine


class FakeSep:
    def __init__(self, fail_times):
        self.fail_times = fail_times
        self.calls = 0
        self.samplerate = 44100

    def update_parameter(self, **kw):
        pass

    def separate_audio_file(self, path):
        self.calls += 1
        if self.calls <= self.fail_times:
            raise RuntimeError("CUDA error: out of memory")
        return None, {"vocals": object()}


def test_falls_back_to_cpu_after_cuda_oom(monkeypatch):
    seps = {"cuda": FakeSep(fail_times=99), "cpu": FakeSep(fail_times=0)}

    class Cache:
        def get(self, model, device):
            return seps[device]

    stems, sr, used = engine.run_separation_resilient(
        source_path="x.wav", model="htdemucs", device="cuda",
        on_progress=lambda f, s: None, cache=Cache(), segments=(None, 8),
    )
    assert used == "cpu" and sr == 44100 and "vocals" in stems


def test_succeeds_on_cuda_with_smaller_segment(monkeypatch):
    cuda = FakeSep(fail_times=1)  # first (full segment) fails, second (smaller) ok

    class Cache:
        def get(self, model, device):
            return cuda

    stems, sr, used = engine.run_separation_resilient(
        source_path="x.wav", model="htdemucs", device="cuda",
        on_progress=lambda f, s: None, cache=Cache(), segments=(None, 8),
    )
    assert used == "cuda" and cuda.calls == 2