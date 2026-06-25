from __future__ import annotations

import json
import shutil
import uuid
from datetime import datetime, timezone
from typing import Optional

from app.core import paths
from app.core.schemas import JobCreate, JobOut


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _row_to_job(row) -> JobOut:
    d = dict(row)
    d["requested_stems"] = json.loads(d["requested_stems"]) if d.get("requested_stems") else None
    d["stems"] = json.loads(d["stems"]) if d.get("stems") else None
    return JobOut(**d)


def create_job(conn, *, source_filename, source_path, source_format,
               source_duration, source_bytes, spec: JobCreate,
               job_id: Optional[str] = None) -> JobOut:
    jid = job_id or uuid.uuid4().hex
    now = _now()
    conn.execute(
        """INSERT INTO jobs (id,batch_id,created_at,updated_at,status,attempts,
            source_filename,source_path,source_format,source_duration,source_bytes,
            model,output_format,output_bitrate,output_bitdepth,requested_stems,progress)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (jid, spec.batch_id, now, now, "queued", 0,
         source_filename, str(source_path), source_format, source_duration, source_bytes,
         spec.model, spec.output_format, spec.output_bitrate, spec.output_bitdepth,
         json.dumps(spec.requested_stems) if spec.requested_stems else None, 0.0),
    )
    conn.commit()
    return get_job(conn, jid)


def get_job(conn, jid) -> Optional[JobOut]:
    row = conn.execute("SELECT * FROM jobs WHERE id=?", (jid,)).fetchone()
    return _row_to_job(row) if row else None


def list_jobs(conn, *, status=None, batch_id=None, limit=100, offset=0):
    q = "SELECT * FROM jobs"
    clauses, args = [], []
    if status:
        clauses.append("status=?"); args.append(status)
    if batch_id:
        clauses.append("batch_id=?"); args.append(batch_id)
    if clauses:
        q += " WHERE " + " AND ".join(clauses)
    q += " ORDER BY created_at DESC LIMIT ? OFFSET ?"
    args += [limit, offset]
    return [_row_to_job(r) for r in conn.execute(q, args).fetchall()]


def claim_next(conn, device) -> Optional[JobOut]:
    conn.execute("BEGIN IMMEDIATE")
    row = conn.execute(
        "SELECT id FROM jobs WHERE status='queued' ORDER BY created_at LIMIT 1"
    ).fetchone()
    if not row:
        conn.commit()
        return None
    jid = row["id"]
    conn.execute(
        "UPDATE jobs SET status='running', device_used=?, attempts=attempts+1, updated_at=? WHERE id=?",
        (device, _now(), jid),
    )
    conn.commit()
    return get_job(conn, jid)


def update_progress(conn, jid, progress, stage=None) -> None:
    conn.execute(
        "UPDATE jobs SET progress=?, progress_stage=?, updated_at=? WHERE id=?",
        (progress, stage, _now(), jid),
    )
    conn.commit()


def finish_job(conn, jid, stems: dict) -> None:
    conn.execute(
        "UPDATE jobs SET status='done', progress=1.0, stems=?, error_message=NULL, updated_at=? WHERE id=?",
        (json.dumps(stems), _now(), jid),
    )
    conn.commit()


def fail_or_requeue(conn, jid, message, max_attempts) -> None:
    job = get_job(conn, jid)
    requeue = job is not None and job.attempts <= max_attempts
    status = "queued" if requeue else "failed"
    conn.execute(
        "UPDATE jobs SET status=?, error_message=?, updated_at=? WHERE id=?",
        (status, message, _now(), jid),
    )
    conn.commit()


def cancel_job(conn, jid) -> bool:
    cur = conn.execute(
        "UPDATE jobs SET status='canceled', updated_at=? WHERE id=? AND status='queued'",
        (_now(), jid),
    )
    conn.commit()
    return cur.rowcount > 0


def recover_stuck(conn, max_attempts) -> None:
    rows = conn.execute("SELECT id, attempts FROM jobs WHERE status='running'").fetchall()
    for r in rows:
        if r["attempts"] <= max_attempts:
            conn.execute("UPDATE jobs SET status='queued', updated_at=? WHERE id=?", (_now(), r["id"]))
        else:
            conn.execute(
                "UPDATE jobs SET status='failed', error_message=?, updated_at=? WHERE id=?",
                ("Worker interrupted mid-job", _now(), r["id"]),
            )
    conn.commit()


def delete_job(conn, jid) -> bool:
    if get_job(conn, jid) is None:
        return False
    conn.execute("DELETE FROM jobs WHERE id=?", (jid,))
    conn.commit()
    for d in (paths.stems_dir(jid), paths.mixdowns_dir(jid), paths.job_upload_dir(jid)):
        shutil.rmtree(d, ignore_errors=True)
    return True


def set_meta(conn, key, value) -> None:
    conn.execute(
        "INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        (key, value),
    )
    conn.commit()


def get_meta(conn, key) -> Optional[str]:
    r = conn.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
    return r["value"] if r else None


def create_mixdown(conn, *, job_id, name, spec_json, path, fmt):
    from app.core.schemas import MixdownOut

    mid = uuid.uuid4().hex
    now = _now()
    conn.execute(
        "INSERT INTO mixdowns (id,job_id,name,spec,path,format,created_at) VALUES (?,?,?,?,?,?,?)",
        (mid, job_id, name, spec_json, str(path), fmt, now),
    )
    conn.commit()
    return MixdownOut(id=mid, job_id=job_id, name=name, format=fmt, created_at=now)


def get_mixdown(conn, mid):
    row = conn.execute("SELECT * FROM mixdowns WHERE id=?", (mid,)).fetchone()
    return dict(row) if row else None