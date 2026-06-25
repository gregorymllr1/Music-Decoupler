import pytest

from app.config import get_settings


@pytest.fixture
def settings(tmp_path, monkeypatch):
    monkeypatch.setenv("STUDIO_DATA_DIR", str(tmp_path / "data"))
    get_settings.cache_clear()
    yield get_settings()
    get_settings.cache_clear()


@pytest.fixture
def conn(settings):
    from app.core.db import get_connection, init_db

    c = get_connection()
    init_db(c)
    yield c
    c.close()
