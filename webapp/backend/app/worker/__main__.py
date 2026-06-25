from __future__ import annotations

import time
from datetime import datetime, timezone

from app.config import get_settings
from app.core import jobs, paths
from app.core.db import get_connection, init_db


def process_one(conn, job, *, separate_fn, encode_fn, max_attempts) -> None:
    try:
        def on_progress(frac, stage):
            jobs.update_progress(conn, job.id, frac, stage)

        stems, samplerate = separate_fn(job, on_progress)
        stem_paths = encode_fn(job, stems, samplerate)
        jobs.finish_job(conn, job.id, stem_paths)
    except Exception as e:  # noqa: BLE001 — record any failure on the job
        jobs.fail_or_requeue(conn, job.id, f"{type(e).__name__}: {e}", max_attempts)


def _real_separate(cache):
    from app.worker import engine

    def fn(job, on_progress):
        stems, sr, used = engine.run_separation_resilient(
            source_path=job.source_path, model=job.model,
            device=job.device_used or engine.detect_device(),
            on_progress=on_progress, cache=cache,
        )
        return stems, sr

    return fn


def _real_encode(job, stems, samplerate):
    from app.worker.encode import save_stem

    fmt = job.output_format
    wanted = set(job.requested_stems) if job.requested_stems else None
    out = {}
    for name, wav in stems.items():
        if wanted and name not in wanted:
            continue
        p = paths.stem_path(job.id, name, fmt)
        save_stem(wav, p, samplerate=samplerate, fmt=fmt,
                  bitrate=job.output_bitrate or 320, bitdepth=job.output_bitdepth or 16)
        out[name] = str(p.relative_to(get_settings().data_dir))
    return out


def main() -> None:
    from app.worker import engine

    settings = get_settings()
    init_db()
    conn = get_connection()
    cache = engine.ModelCache(maxsize=settings.model_cache_size)
    separate_fn = _real_separate(cache)

    jobs.recover_stuck(conn, settings.max_attempts)
    device = engine.detect_device()
    jobs.set_meta(conn, "device", device)
    print(f"[worker] started on device={device}")

    while True:
        jobs.set_meta(conn, "worker_heartbeat", datetime.now(timezone.utc).isoformat())
        job = jobs.claim_next(conn, device)
        if job is None:
            time.sleep(settings.worker_poll_interval)
            continue
        print(f"[worker] processing {job.id} ({job.source_filename})")
        process_one(conn, job, separate_fn=separate_fn, encode_fn=_real_encode,
                    max_attempts=settings.max_attempts)


if __name__ == "__main__":
    main()