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