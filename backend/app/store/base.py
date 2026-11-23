"""Repository interface shared by the Supabase and in-memory stores."""
from __future__ import annotations

from abc import ABC, abstractmethod
from datetime import datetime
from typing import Any, Optional

from app.models import Approval, AuditEvent, Contract, Milestone, Submission, Verdict


class Repository(ABC):
    name: str = "base"

    # Contracts
    @abstractmethod
    def create_contract(self, contract: Contract) -> Contract: ...

    @abstractmethod
    def list_contracts(self) -> list[Contract]: ...

    @abstractmethod
    def get_contract(self, contract_id: str) -> Optional[Contract]: ...

    @abstractmethod
    def update_contract(self, contract_id: str, **fields: Any) -> Optional[Contract]: ...

    # Milestones
    @abstractmethod
    def get_milestone(self, milestone_id: str) -> Optional[Milestone]: ...

    @abstractmethod
    def update_milestone(self, milestone_id: str, **fields: Any) -> Optional[Milestone]: ...

    # Submissions / verdicts
    @abstractmethod
    def add_submission(self, submission: Submission) -> Submission: ...

    @abstractmethod
    def add_verdict(self, verdict: Verdict) -> Verdict: ...

    @abstractmethod
    def list_submissions(self, milestone_id: str) -> list[Submission]: ...

    # Approvals
    @abstractmethod
    def add_approval(self, approval: Approval) -> Approval: ...

    @abstractmethod
    def get_approval(self, approval_id: str) -> Optional[Approval]: ...

    @abstractmethod
    def list_approvals(self, status: Optional[str] = None) -> list[Approval]: ...

    @abstractmethod
    def transition_approval(
        self,
        approval_id: str,
        from_status: str,
        to_status: str,
        decided_by: Optional[str],
        decided_at: Optional[datetime],
    ) -> Optional[Approval]:
        """Atomically move an approval from `from_status` to `to_status`.

        Returns the updated approval, or None if it was not in `from_status`
        (e.g. it was already decided by someone else).
        """

    # Audit
    @abstractmethod
    def add_audit(self, event: AuditEvent) -> AuditEvent: ...

    @abstractmethod
    def list_audit(self, contract_id: str) -> list[AuditEvent]:
        """Newest first."""
