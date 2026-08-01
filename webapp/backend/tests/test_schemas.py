import pytest
from pydantic import ValidationError

from app.core.schemas import JobCreate, JobOut, MixdownRequest


def test_jobcreate_defaults():
    j = JobCreate()
    assert j.model == "htdemucs"
    assert j.output_format == "wav"
    assert j.requested_stems is None


def test_jobout_from_row_dict():
    row = dict(
        id="a", batch_id=None, created_at="t", updated_at="t", status="queued",
        attempts=0, source_filename="x.mp3", source_format="mp3",
        source_duration=10.0, source_bytes=123, model="htdemucs",
        output_format="wav", output_bitrate=None, output_bitdepth=16,
        requested_stems=["vocals"], device_used=None, progress=0.0,
        progress_stage=None, stems={"vocals": "p"}, error_message=None,
    )
    out = JobOut(**row)
    assert out.status == "queued"
    assert out.stems == {"vocals": "p"}


def test_mixdown_request_validation():
    m = MixdownRequest(tracks=[{"stem": "vocals", "gain": 0.0, "muted": True}])
    assert m.tracks[0].muted is True
    assert m.format == "mp3"


def test_mixdown_request_accepts_valid_range():
    m = MixdownRequest(tracks=[{"stem": "v"}], start_sec=1.0, end_sec=2.5)
    assert m.start_sec == 1.0
    assert m.end_sec == 2.5


def test_mixdown_request_defaults_have_no_range():
    m = MixdownRequest(tracks=[{"stem": "v"}])
    assert m.start_sec is None and m.end_sec is None


def test_mixdown_request_rejects_bad_ranges():
    with pytest.raises(ValidationError):
        MixdownRequest(tracks=[{"stem": "v"}], start_sec=-1.0)
    with pytest.raises(ValidationError):
        MixdownRequest(tracks=[{"stem": "v"}], start_sec=2.0, end_sec=2.0)
    with pytest.raises(ValidationError):
        MixdownRequest(tracks=[{"stem": "v"}], end_sec=0.0)


def test_jobcreate_quality_defaults():
    j = JobCreate()
    assert j.shifts == 1
    assert j.overlap == 0.25


def test_jobcreate_rejects_out_of_range_quality():
    with pytest.raises(ValidationError):
        JobCreate(shifts=0)
    with pytest.raises(ValidationError):
        JobCreate(shifts=11)
    with pytest.raises(ValidationError):
        JobCreate(overlap=0.05)
    with pytest.raises(ValidationError):
        JobCreate(overlap=0.95)


def test_jobout_quality_fields_optional():
    row = dict(
        id="a", batch_id=None, created_at="t", updated_at="t", status="queued",
        attempts=0, source_filename="x.mp3", source_format="mp3",
        source_duration=10.0, source_bytes=123, model="htdemucs",
        output_format="wav", output_bitrate=None, output_bitdepth=16,
        requested_stems=None, device_used=None, progress=0.0,
        progress_stage=None, stems=None, error_message=None,
    )
    out = JobOut(**row)  # no shifts/overlap keys at all (old DB row)
    assert out.shifts is None and out.overlap is None
    out2 = JobOut(**row, shifts=2, overlap=0.5)
    assert out2.shifts == 2 and out2.overlap == 0.5