"""Thread-safe in-memory repository used when Supabase is not configured."""
from __future__ import annotations

import threading
from datetime import datetime
from typing import Any, Optional

from app.models import Approval, AuditEvent, Contract, Milestone, Submission, Verdict
from app.store.base import Repository


class MemoryStore(Repository):
    name = "memory"

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._contracts: dict[str, Contract] = {}
        self._milestones: dict[str, Milestone] = {}
        self._submissions: dict[str, Submission] = {}
        self._verdicts: dict[str, Verdict] = {}  # keyed by submission_id
        self._approvals: dict[str, Approval] = {}
        self._audit: list[AuditEvent] = []

    # ---- helpers ----
    def _assemble(self, contract: Contract) -> Contract:
        ms = sorted(
            (m for m in self._milestones.values() if m.contract_id == contract.id),
            key=lambda m: m.seq,
        )
        return contract.model_copy(update={"milestones": [m.model_copy() for m in ms]}, deep=True)

    # ---- contracts ----
    def create_contract(self, contract: Contract) -> Contract:
        with self._lock:
            self._contracts[contract.id] = contract.model_copy(update={"milestones": []}, deep=True)
            for m in contract.milestones:
                self._milestones[m.id] = m.model_copy(deep=True)
            return self._assemble(self._contracts[contract.id])

    def list_contracts(self) -> list[Contract]:
        with self._lock:
            items = sorted(self._contracts.values(), key=lambda c: c.created_at, reverse=True)
            return [self._assemble(c) for c in items]

    def get_contract(self, contract_id: str) -> Optional[Contract]:
        with self._lock:
            c = self._contracts.get(contract_id)
            return self._assemble(c) if c else None

    def update_contract(self, contract_id: str, **fields: Any) -> Optional[Contract]:
        with self._lock:
            c = self._contracts.get(contract_id)
            if not c:
                return None
            self._contracts[contract_id] = c.model_copy(update=fields)
            return self._assemble(self._contracts[contract_id])

    # ---- milestones ----
    def get_milestone(self, milestone_id: str) -> Optional[Milestone]:
        with self._lock:
            m = self._milestones.get(milestone_id)
            return m.model_copy() if m else None

    def update_milestone(self, milestone_id: str, **fields: Any) -> Optional[Milestone]:
        with self._lock:
            m = self._milestones.get(milestone_id)
            if not m:
                return None
            self._milestones[milestone_id] = m.model_copy(update=fields)
            return self._milestones[milestone_id].model_copy()

    # ---- submissions ----
    def add_submission(self, submission: Submission) -> Submission:
        with self._lock:
            self._submissions[submission.id] = submission.model_copy(update={"verdict": None}, deep=True)
            return submission

    def add_verdict(self, verdict: Verdict) -> Verdict:
        with self._lock:
            self._verdicts[verdict.submission_id] = verdict.model_copy(deep=True)
            return verdict

    def list_submissions(self, milestone_id: str) -> list[Submission]:
        with self._lock:
            subs = sorted(
                (s for s in self._submissions.values() if s.milestone_id == milestone_id),
                key=lambda s: s.created_at,
                reverse=True,
            )
            return [s.model_copy(update={"verdict": self._verdicts.get(s.id)}, deep=True) for s in subs]

    # ---- approvals ----
    def add_approval(self, approval: Approval) -> Approval:
        with self._lock:
            self._approvals[approval.id] = approval.model_copy()
            return approval

    def get_approval(self, approval_id: str) -> Optional[Approval]:
        with self._lock:
            a = self._approvals.get(approval_id)
            return a.model_copy() if a else None

    def list_approvals(self, status: Optional[str] = None) -> list[Approval]:
        with self._lock:
            items = [a for a in self._approvals.values() if status is None or a.status == status]
            return [a.model_copy() for a in sorted(items, key=lambda a: a.created_at, reverse=True)]

    def transition_approval(
        self,
        approval_id: str,
        from_status: str,
        to_status: str,
        decided_by: Optional[str],
        decided_at: Optional[datetime],
    ) -> Optional[Approval]:
        with self._lock:
            a = self._approvals.get(approval_id)
            if not a or a.status != from_status:
                return None
            updated = a.model_copy(update={"status": to_status, "decided_by": decided_by, "decided_at": decided_at})
            self._approvals[approval_id] = updated
            return updated.model_copy()

    # ---- audit ----
    def add_audit(self, event: AuditEvent) -> AuditEvent:
        with self._lock:
            self._audit.append(event.model_copy(deep=True))
            return event

    def list_audit(self, contract_id: str) -> list[AuditEvent]:
        with self._lock:
            # Stable newest-first: reverse insertion order (timestamps can tie).
            return [e.model_copy(deep=True) for e in reversed(self._audit) if e.contract_id == contract_id]
