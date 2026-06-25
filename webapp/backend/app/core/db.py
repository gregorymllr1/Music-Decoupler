from __future__ import annotations

import sqlite3
from pathlib import Path

from app.config import get_settings

SCHEMA = """
CREATE TABLE IF NOT EXISTS jobs (
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
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status, created_at);
CREATE INDEX IF NOT EXISTS idx_jobs_batch  ON jobs(batch_id);

CREATE TABLE IF NOT EXISTS mixdowns (
  id         TEXT PRIMARY KEY,
  job_id     TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  spec       TEXT NOT NULL,
  path       TEXT NOT NULL,
  format     TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);
"""


def db_path() -> Path:
    return get_settings().data_dir / "app.db"


def get_connection() -> sqlite3.Connection:
    p = db_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(p, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db(conn: sqlite3.Connection | None = None) -> None:
    own = conn is None
    conn = conn or get_connection()
    conn.executescript(SCHEMA)
    conn.commit()
    if own:
        conn.close()