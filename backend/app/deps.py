"""Service container shared by routers and agents (stored on app.state.ctx)."""
from __future__ import annotations

from dataclasses import dataclass

from fastapi import Request

from app.config import Settings
from app.services.gemini import GeminiService
from app.services.ocr import OCRService
from app.services.paypal import PayPalService
from app.store import build_store
from app.store.base import Repository


@dataclass
class AppContext:
    settings: Settings
    store: Repository
    gemini: GeminiService
    paypal: PayPalService
    ocr: OCRService


def build_context(settings: Settings, store: Repository | None = None) -> AppContext:
    return AppContext(
        settings=settings,
        store=store if store is not None else build_store(settings),
        gemini=GeminiService(settings),
        paypal=PayPalService(settings),
        ocr=OCRService(settings),
    )


def get_ctx(request: Request) -> AppContext:
    return request.app.state.ctx
