import pytest

from app.core import audio_probe as ap


def test_validate_rejects_unknown_ext(settings):
    with pytest.raises(ap.UploadError) as e:
        ap.validate_upload("notes.txt", 10)
    assert e.value.status_code == 415


def test_validate_rejects_oversize(settings, monkeypatch):
    monkeypatch.setattr(ap.get_settings(), "max_upload_bytes", 5, raising=False)
    with pytest.raises(ap.UploadError) as e:
        ap.validate_upload("song.mp3", 6)
    assert e.value.status_code == 413


def test_validate_accepts_audio(settings):
    assert ap.validate_upload("Song Name.FLAC", 100) == "flac"


def test_probe_parses_ffprobe(monkeypatch, tmp_path):
    import subprocess

    class FakeProc:
        stdout = '{"format": {"duration": "12.50", "format_name": "mp3"}}'

    monkeypatch.setattr(subprocess, "run", lambda *a, **k: FakeProc())
    dur, fmt = ap.probe(tmp_path / "x.mp3")
    assert dur == 12.5 and fmt == "mp3"


def test_probe_handles_missing_ffprobe(monkeypatch, tmp_path):
    import subprocess

    def boom(*a, **k):
        raise FileNotFoundError()

    monkeypatch.setattr(subprocess, "run", boom)
    assert ap.probe(tmp_path / "x.mp3") == (None, None)