from app.core import jobs
from app.core.schemas import JobCreate
from app.worker.__main__ import process_one


def _queued(conn):
    return jobs.create_job(
        conn, source_filename="s.wav", source_path="/tmp/s.wav",
        source_format="wav", source_duration=1.0, source_bytes=1, spec=JobCreate(),
    )


def test_process_one_success(conn):
    _queued(conn)
    job = jobs.claim_next(conn, "cpu")

    def fake_separate(job, on_progress):
        on_progress(0.5, "model 1/1")
        return {"vocals": object()}, 44100

    def fake_encode(job, stems, sr):
        return {"vocals": f"stems/{job.id}/vocals.wav"}

    process_one(conn, job, separate_fn=fake_separate, encode_fn=fake_encode, max_attempts=1)
    done = jobs.get_job(conn, job.id)
    assert done.status == "done"
    assert done.stems["vocals"].endswith("vocals.wav")


def test_process_one_failure_requeues(conn):
    _queued(conn)
    job = jobs.claim_next(conn, "cpu")  # attempts=1

    def boom(job, on_progress):
        raise RuntimeError("kaboom")

    process_one(conn, job, separate_fn=boom, encode_fn=lambda *a: {}, max_attempts=1)
    assert jobs.get_job(conn, job.id).status == "queued"