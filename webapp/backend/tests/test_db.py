from app.core.db import get_connection, init_db

OLD_JOBS_SCHEMA = """
CREATE TABLE jobs (
  id              TEXT PRIMARY KEY,
  batch_id        TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  status          TEXT NOT NULL,
  attempts        INTEGER NOT NULL DEFAULT 0,
  source_filename TEXT NOT NULL,
  source_path     TEXT NOT NULL,
  source_format   TEXT,
  source_duration REAL,
  source_bytes    INTEGER,
  model           TEXT NOT NULL,
  output_format   TEXT NOT NULL,
  output_bitrate  INTEGER,
  output_bitdepth INTEGER,
  requested_stems TEXT,
  device_used     TEXT,
  progress        REAL NOT NULL DEFAULT 0,
  progress_stage  TEXT,
  stems           TEXT,
  error_message   TEXT
);
"""


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


def test_init_db_migrates_existing_jobs_table(settings):
    from app.core import jobs

    c = get_connection()
    c.executescript(OLD_JOBS_SCHEMA)  # simulate a database created before this feature
    c.execute(
        "INSERT INTO jobs (id,created_at,updated_at,status,attempts,source_filename,"
        "source_path,model,output_format,progress) "
        "VALUES ('old1','t','t','queued',0,'f.mp3','p','htdemucs','wav',0)"
    )
    c.commit()
    init_db(c)  # must ALTER TABLE, not fail, not drop data
    cols = {r["name"] for r in c.execute("PRAGMA table_info(jobs)")}
    assert {"shifts", "overlap"} <= cols
    job = jobs.get_job(c, "old1")
    assert job is not None
    assert job.shifts is None and job.overlap is None
    c.close()


def test_fresh_db_has_quality_columns(settings):
    c = get_connection()
    init_db(c)
    cols = {r["name"] for r in c.execute("PRAGMA table_info(jobs)")}
    assert {"shifts", "overlap"} <= cols
    c.close()