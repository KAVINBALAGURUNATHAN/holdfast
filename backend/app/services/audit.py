"""Audit trail helper. Every agent and human decision goes through `record`."""
from __future__ import annotations

import logging
from typing import Any, Optional

from app.models import AuditEvent
from app.store.base import Repository

log = logging.getLogger("holdfast.audit")

_SECRET_HINTS = ("secret", "token", "api_key", "apikey", "password", "authorization_header", "client_id")


def _scrub(value: Any) -> Any:
    """Defensive: drop any key that looks like a credential before persisting."""
    if isinstance(value, dict):
        return {
            k: ("[redacted]" if any(h in str(k).lower() for h in _SECRET_HINTS) else _scrub(v))
            for k, v in value.items()
        }
    if isinstance(value, list):
        return [_scrub(v) for v in value]
    return value


def record(
    store: Repository,
    *,
    contract_id: str,
    actor: str,
    action: str,
    milestone_id: Optional[str] = None,
    details: Optional[dict[str, Any]] = None,
) -> AuditEvent:
    event = AuditEvent(
        contract_id=contract_id,
        milestone_id=milestone_id,
        actor=actor,
        action=action,
        details=_scrub(details or {}),
    )
    store.add_audit(event)
    log.info("audit %s by %s (contract=%s milestone=%s)", action, actor, contract_id, milestone_id)
    return event
