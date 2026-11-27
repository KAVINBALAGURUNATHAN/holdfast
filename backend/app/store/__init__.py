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

        try:
            store = SupabaseStore(settings.supabase_url, settings.supabase_service_key)
        except Exception as exc:  # noqa: BLE001 - a bad key must not stop the API from starting
            # e.g. supabase-py rejects keys that are not JWTs ("Invalid API key") with older versions.
            # Fall back so the app still runs; /api/health reports supabase=false.
            log.error("Supabase store unavailable (%s: %s); falling back to in-memory store. "
                      "Data will NOT survive a restart.", type(exc).__name__, exc)
            return MemoryStore()
        log.info("Using Supabase store")
        return store
    log.info("Supabase not configured; using in-memory store")
    return MemoryStore()


__all__ = ["Repository", "MemoryStore", "build_store"]
