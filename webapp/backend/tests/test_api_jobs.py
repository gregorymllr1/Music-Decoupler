import io

from fastapi.testclient import TestClient

from app.main import create_app


def _client(settings):
    return TestClient(create_app())


def _wav_bytes():
    # 0.1s of silence, mono, 8kHz, valid WAV via stdlib (no torch needed)
    import wave

    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(8000)
        w.writeframes(b"\x00\x00" * 800)
    return buf.getvalue()


def test_upload_creates_queued_job(settings, monkeypatch):
    # avoid requiring ffprobe in CI
    monkeypatch.setattr("app.api.routes_jobs.probe", lambda p: (0.1, "wav"))
    client = _client(settings)
    r = client.post(
        "/api/jobs",
        files={"file": ("clip.wav", _wav_bytes(), "audio/wav")},
        data={"model": "htdemucs", "output_format": "wav"},
    )
    assert r.status_code == 200, r.text
    job = r.json()
    assert job["status"] == "queued" and job["model"] == "htdemucs"
    assert client.get(f"/api/jobs/{job['id']}").json()["id"] == job["id"]
    assert any(j["id"] == job["id"] for j in client.get("/api/jobs").json())


def test_upload_rejects_bad_type(settings):
    client = _client(settings)
    r = client.post("/api/jobs", files={"file": ("notes.txt", b"hi", "text/plain")})
    assert r.status_code == 415


def test_delete_job(settings, monkeypatch):
    monkeypatch.setattr("app.api.routes_jobs.probe", lambda p: (0.1, "wav"))
    client = _client(settings)
    jid = client.post("/api/jobs", files={"file": ("c.wav", _wav_bytes(), "audio/wav")}).json()["id"]
    assert client.delete(f"/api/jobs/{jid}").json()["deleted"] is True
    assert client.get(f"/api/jobs/{jid}").status_code == 404


def test_upload_accepts_quality_fields(settings, monkeypatch):
    monkeypatch.setattr("app.api.routes_jobs.probe", lambda p: (0.1, "wav"))
    client = _client(settings)
    r = client.post(
        "/api/jobs",
        files={"file": ("clip.wav", _wav_bytes(), "audio/wav")},
        data={"model": "htdemucs_ft", "shifts": "2", "overlap": "0.5"},
    )
    assert r.status_code == 200, r.text
    job = r.json()
    assert job["model"] == "htdemucs_ft"
    assert job["shifts"] == 2 and job["overlap"] == 0.5


def test_upload_rejects_out_of_range_quality(settings):
    client = _client(settings)
    r = client.post(
        "/api/jobs",
        files={"file": ("clip.wav", _wav_bytes(), "audio/wav")},
        data={"shifts": "99"},
    )
    assert r.status_code == 422
    r = client.post(
        "/api/jobs",
        files={"file": ("clip.wav", _wav_bytes(), "audio/wav")},
        data={"overlap": "0.95"},
    )
    assert r.status_code == 422


def test_upload_defaults_quality_fields(settings, monkeypatch):
    monkeypatch.setattr("app.api.routes_jobs.probe", lambda p: (0.1, "wav"))
    client = _client(settings)
    r = client.post("/api/jobs", files={"file": ("clip.wav", _wav_bytes(), "audio/wav")})
    assert r.status_code == 200, r.text
    job = r.json()
    assert job["shifts"] == 1 and job["overlap"] == 0.25