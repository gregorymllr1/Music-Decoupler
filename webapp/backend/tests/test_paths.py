from app.core import paths


def test_paths_rooted_in_data_dir(settings):
    root = settings.data_dir
    assert paths.upload_path("job1", "mp3") == root / "uploads" / "job1" / "source.mp3"
    assert paths.upload_path("job1", ".flac") == root / "uploads" / "job1" / "source.flac"
    assert paths.stem_path("job1", "vocals", "wav") == root / "stems" / "job1" / "vocals.wav"
    assert paths.mixdown_path("job1", "mx1", "mp3") == root / "mixdowns" / "job1" / "mx1.mp3"


def test_ensure_parent_creates_dir(settings, tmp_path):
    target = paths.stem_path("jobX", "bass", "wav")
    paths.ensure_parent(target)
    assert target.parent.is_dir()