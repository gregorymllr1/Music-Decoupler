from app.core import jobs
from app.core.schemas import JobCreate


def _make(conn, name="song.mp3"):
    return jobs.create_job(
        conn, source_filename=name, source_path=f"/tmp/{name}",
        source_format="mp3", source_duration=12.3, source_bytes=999,
        spec=JobCreate(),
    )


def test_create_and_get(conn):
    j = _make(conn)
    assert j.status == "queued"
    assert jobs.get_job(conn, j.id).source_filename == "song.mp3"


def test_claim_is_atomic(conn):
    a = _make(conn, "a.mp3")
    b = _make(conn, "b.mp3")
    first = jobs.claim_next(conn, "cpu")
    second = jobs.claim_next(conn, "cpu")
    third = jobs.claim_next(conn, "cpu")
    assert {first.id, second.id} == {a.id, b.id}
    assert first.status == "running" and first.attempts == 1
    assert third is None


def test_progress_and_finish(conn):
    j = jobs.claim_next(conn, "cpu") or _make(conn)
    j = jobs.claim_next(conn, "cpu") if j is None else j
    jobs.update_progress(conn, j.id, 0.5, "model 1/1")
    assert jobs.get_job(conn, j.id).progress == 0.5
    jobs.finish_job(conn, j.id, {"vocals": "stems/x/vocals.wav"})
    done = jobs.get_job(conn, j.id)
    assert done.status == "done" and done.stems["vocals"].endswith("vocals.wav")


def test_fail_or_requeue_then_fail(conn):
    _make(conn)
    j = jobs.claim_next(conn, "cpu")            # attempts=1
    jobs.fail_or_requeue(conn, j.id, "boom", max_attempts=1)
    assert jobs.get_job(conn, j.id).status == "queued"
    j = jobs.claim_next(conn, "cpu")            # attempts=2
    jobs.fail_or_requeue(conn, j.id, "boom", max_attempts=1)
    failed = jobs.get_job(conn, j.id)
    assert failed.status == "failed" and failed.error_message == "boom"


def test_recover_stuck_requeues(conn):
    _make(conn)
    j = jobs.claim_next(conn, "cpu")
    jobs.recover_stuck(conn, max_attempts=1)
    assert jobs.get_job(conn, j.id).status == "queued"


def test_delete_removes_files(conn, settings):
    from app.core import paths
    j = _make(conn)
    p = paths.stem_path(j.id, "vocals", "wav")
    paths.ensure_parent(p)
    p.write_bytes(b"x")
    assert jobs.delete_job(conn, j.id) is True
    assert jobs.get_job(conn, j.id) is None
    assert not p.exists()


def test_meta_roundtrip(conn):
    jobs.set_meta(conn, "device", "cuda")
    jobs.set_meta(conn, "device", "cpu")
    assert jobs.get_meta(conn, "device") == "cpu"