from __future__ import annotations

from fastapi import FastAPI

from app.core.db import init_db


def create_app() -> FastAPI:
    app = FastAPI(title="Demucs Stem Studio")
    init_db()  # idempotent; ensures tables exist for TestClient and dev runs alike

    from app.api import routes_meta, routes_jobs, routes_stems, routes_mixdown, sse
    app.include_router(routes_meta.router)
    app.include_router(routes_jobs.router)
    app.include_router(routes_stems.router)
    app.include_router(routes_mixdown.router)
    app.include_router(sse.router)
    return app


app = create_app()