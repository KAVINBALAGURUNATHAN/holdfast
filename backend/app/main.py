"""HoldFast API: contract -> auditable escrow workflow with human-approved payments."""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import Settings, get_settings
from app.deps import build_context
from app.routers import approvals, contracts, milestones, system
from app.store.base import Repository

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
# httpx logs full request URLs at INFO; keep it quiet so nothing sensitive lands in logs.
logging.getLogger("httpx").setLevel(logging.WARNING)


def create_app(settings: Optional[Settings] = None, store: Optional[Repository] = None) -> FastAPI:
    settings = settings or get_settings()
    app = FastAPI(title="HoldFast API", version="1.0.0")
    app.state.ctx = build_context(settings, store)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list or ["*"],
        # Local dev servers on any port, whether opened as localhost or 127.0.0.1 (Vite moves to the
        # next free port when 5173 is taken, which would otherwise fail every API call with a CORS error).
        allow_origin_regex=r"http://(localhost|127\.0\.0\.1|\[::1\])(:\d+)?",
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    for r in (system.router, contracts.router, milestones.router, approvals.router):
        app.include_router(r)

    log = logging.getLogger("holdfast")
    log.info(
        "HoldFast started: gemini=%s paypal=%s store=%s ocr=%s",
        app.state.ctx.gemini.enabled, app.state.ctx.paypal.enabled, app.state.ctx.store.name, app.state.ctx.ocr.available,
    )
    return app


app = create_app()
