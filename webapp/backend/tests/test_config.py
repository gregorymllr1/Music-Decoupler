from app.config import get_settings


def test_defaults(monkeypatch):
    monkeypatch.delenv("STUDIO_DEFAULT_MODEL", raising=False)
    get_settings.cache_clear()
    s = get_settings()
    assert s.default_model == "htdemucs"
    assert s.max_upload_bytes == 200 * 1024 * 1024
    assert str(s.data_dir).endswith("data")


def test_env_override(monkeypatch):
    monkeypatch.setenv("STUDIO_DEFAULT_MODEL", "mdx_extra")
    get_settings.cache_clear()
    assert get_settings().default_model == "mdx_extra"
    get_settings.cache_clear()
