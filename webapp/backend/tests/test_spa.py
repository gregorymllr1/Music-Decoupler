from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import create_app


def test_spa_served_when_dist_present(tmp_path, monkeypatch):
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("<!doctype html><title>studio</title>")
    monkeypatch.setenv("STUDIO_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("STUDIO_FRONTEND_DIST", str(dist))
    get_settings.cache_clear()
    client = TestClient(create_app())
    assert client.get("/api/models").status_code == 200  # API still wins
    r = client.get("/")
    assert r.status_code == 200 and "studio" in r.text
    get_settings.cache_clear()