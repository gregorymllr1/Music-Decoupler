from app.core.db import get_connection, init_db


def test_init_db_idempotent(settings):
    c = get_connection()
    init_db(c)
    init_db(c)  # second call must not raise
    tables = {r["name"] for r in c.execute(
        "SELECT name FROM sqlite_master WHERE type='table'"
    )}
    assert {"jobs", "mixdowns", "meta"} <= tables
    assert c.execute("PRAGMA journal_mode").fetchone()[0].lower() == "wal"
    c.close()