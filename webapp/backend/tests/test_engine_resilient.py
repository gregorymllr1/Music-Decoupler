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


class RecordingSep:
    """Mimics demucs Separator's stateful update_parameter across calls."""

    def __init__(self, fail_times=0):
        self.fail_times = fail_times
        self.calls = 0
        self.samplerate = 44100
        self.current = {}
        self.applied = []  # params snapshot at each separate_audio_file call

    def update_parameter(self, **kw):
        self.current.update(kw)

    def separate_audio_file(self, path):
        self.calls += 1
        self.applied.append(dict(self.current))
        if self.calls <= self.fail_times:
            raise RuntimeError("CUDA error: out of memory")
        return None, {"vocals": object()}


class _SingleSepCache:
    def __init__(self, sep):
        self.sep = sep

    def get(self, model, device):
        return self.sep


def test_quality_params_applied_every_job():
    sep = RecordingSep()
    cache = _SingleSepCache(sep)
    engine.run_separation_resilient(
        source_path="x.wav", model="htdemucs", device="cpu",
        on_progress=lambda f, s: None, cache=cache, shifts=2, overlap=0.5,
    )
    # second job on the SAME cached separator, default quality
    engine.run_separation_resilient(
        source_path="y.wav", model="htdemucs", device="cpu",
        on_progress=lambda f, s: None, cache=cache,
    )
    assert sep.applied[0]["shifts"] == 2 and sep.applied[0]["overlap"] == 0.5
    assert sep.applied[1]["shifts"] == 1 and sep.applied[1]["overlap"] == 0.25


def test_segment_resets_between_jobs_after_oom_fallback():
    sep = RecordingSep(fail_times=1)  # job 1: full segment OOMs, retry succeeds
    cache = _SingleSepCache(sep)
    engine.run_separation_resilient(
        source_path="x.wav", model="htdemucs", device="cuda",
        on_progress=lambda f, s: None, cache=cache, segments=(None, 8),
    )
    assert sep.applied[1]["segment"] == 8
    # job 2 must NOT inherit segment=8 from job 1's fallback
    engine.run_separation_resilient(
        source_path="y.wav", model="htdemucs", device="cuda",
        on_progress=lambda f, s: None, cache=cache, segments=(None, 8),
    )
    assert sep.applied[2]["segment"] is None


def test_progress_callback_uses_total_shifts():
    sep = RecordingSep()
    cache = _SingleSepCache(sep)
    seen = []
    engine.run_separation_resilient(
        source_path="x.wav", model="htdemucs", device="cpu",
        on_progress=lambda f, s: seen.append(f), cache=cache, shifts=2,
    )
    cb = sep.current["callback"]
    cb({"state": "end", "models": 4, "model_idx_in_bag": 0, "shift_idx": 1,
        "segment_offset": 0, "audio_length": 10})
    # (0*2 + 1 + 0) / (4*2) = 0.125
    assert seen and abs(seen[-1] - 0.125) < 0.01