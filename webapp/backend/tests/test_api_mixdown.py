import numpy as np
import soundfile as sf
from fastapi.testclient import TestClient

from app.core import jobs, paths
from app.core.db import get_connection, init_db
from app.core.schemas import JobCreate
from app.main import create_app


def _finished_job(settings):
    init_db()
    conn = get_connection()
    job = jobs.create_job(
        conn, source_filename="s.wav", source_path="/tmp/s.wav",
        source_format="wav", source_duration=1.0, source_bytes=1, spec=JobCreate(),
    )
    stems = {}
    for name, val in (("vocals", 0.5), ("drums", 0.2)):
        p = paths.ensure_parent(paths.stem_path(job.id, name, "wav"))
        sf.write(str(p), np.full((4410, 2), val, dtype="float32"), 44100, subtype="FLOAT")
        stems[name] = str(p.relative_to(settings.data_dir))
    jobs.finish_job(conn, job.id, stems)
    conn.close()
    return job


def test_create_and_download_mixdown(settings):
    job = _finished_job(settings)
    client = TestClient(create_app())
    r = client.post(
        f"/api/jobs/{job.id}/mixdown",
        json={"name": "instrumental", "format": "wav",
              "tracks": [{"stem": "vocals", "gain": 1.0, "muted": True},
                         {"stem": "drums", "gain": 1.0, "muted": False}]},
    )
    assert r.status_code == 200, r.text
    mid = r.json()["id"]
    dl = client.get(f"/api/mixdowns/{mid}/download")
    assert dl.status_code == 200 and len(dl.content) > 0