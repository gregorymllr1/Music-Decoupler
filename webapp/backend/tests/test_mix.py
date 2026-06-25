import numpy as np
import soundfile as sf

from app.core import mix
from app.core.schemas import MixdownTrack


def _write(path, value, sr=44100, frames=4410):
    data = np.full((frames, 2), value, dtype="float32")
    sf.write(str(path), data, sr, subtype="FLOAT")


def test_mix_skips_muted(tmp_path):
    _write(tmp_path / "vocals.wav", 0.4)
    _write(tmp_path / "drums.wav", 0.1)
    resolve = lambda stem: tmp_path / f"{stem}.wav"
    tracks = [
        MixdownTrack(stem="vocals", gain=1.0, muted=True),
        MixdownTrack(stem="drums", gain=1.0, muted=False),
    ]
    out, sr = mix.mix_tracks(tracks, resolve)
    assert sr == 44100
    assert np.allclose(out, 0.1, atol=1e-4)  # only drums survived


def test_mix_sums_and_rescales(tmp_path):
    _write(tmp_path / "a.wav", 0.8)
    _write(tmp_path / "b.wav", 0.8)
    resolve = lambda stem: tmp_path / f"{stem}.wav"
    tracks = [MixdownTrack(stem="a"), MixdownTrack(stem="b")]
    out, _ = mix.mix_tracks(tracks, resolve)
    assert float(np.max(np.abs(out))) <= 1.0 + 1e-6  # 1.6 peak rescaled


def test_render_writes_flac(tmp_path):
    _write(tmp_path / "a.wav", 0.2)
    resolve = lambda stem: tmp_path / f"{stem}.wav"
    out = mix.render_mixdown([MixdownTrack(stem="a")], resolve, tmp_path / "mix.flac", "flac")
    data, sr = sf.read(str(out))
    assert sr == 44100 and data.shape[0] == 4410