from fastapi.testclient import TestClient

from app.main import create_app


def test_health_ok(settings):
    client = TestClient(create_app())
    r = client.get("/api/health")
    assert r.status_code == 200
    body = r.json()
    assert body["db"] is True
    assert "ffmpeg" in body and "worker_alive" in body


def test_models_lists_htdemucs(settings):
    client = TestClient(create_app())
    r = client.get("/api/models")
    names = {m["name"]: m for m in r.json()}
    assert "htdemucs" in names
    assert names["htdemucs"]["stems"] == ["drums", "bass", "other", "vocals"]
    assert set(names["htdemucs_6s"]["stems"]) >= {"guitar", "piano"}