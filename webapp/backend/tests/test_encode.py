import pytest

torch = pytest.importorskip("torch")
sf = pytest.importorskip("soundfile")

from app.worker.encode import save_stem


@pytest.mark.integration
def test_save_wav_roundtrip(tmp_path):
    wav = torch.zeros(2, 4410)
    out = tmp_path / "vocals.wav"
    save_stem(wav, out, samplerate=44100, fmt="wav", bitdepth=16)
    data, sr = sf.read(str(out))
    assert sr == 44100 and data.shape[0] == 4410 and data.shape[1] == 2


@pytest.mark.integration
def test_save_flac_roundtrip(tmp_path):
    wav = torch.zeros(2, 4410)
    out = tmp_path / "vocals.flac"
    save_stem(wav, out, samplerate=44100, fmt="flac")
    data, sr = sf.read(str(out))
    assert sr == 44100 and data.shape[0] == 4410