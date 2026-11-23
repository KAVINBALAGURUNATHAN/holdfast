"""Store selection: Supabase when SUPABASE_URL + SUPABASE_SERVICE_KEY are set, else in-memory."""
from __future__ import annotations

import logging

from app.config import Settings
from app.store.base import Repository
from app.store.memory_store import MemoryStore

log = logging.getLogger("holdfast.store")


def build_store(settings: Settings) -> Repository:
    if settings.supabase_enabled:
        from app.store.supabase_store import SupabaseStore

        log.info("Using Supabase store")
        return SupabaseStore(settings.supabase_url, settings.supabase_service_key)
    log.info("Supabase not configured; using in-memory store")
    return MemoryStore()


__all__ = ["Repository", "MemoryStore", "build_store"]
