"""Supabase (Postgres) repository. Schema: supabase/schema.sql at repo root."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from app.models import Approval, AuditEvent, Contract, Milestone, Submission, Verdict
from app.store.base import Repository


def _jsonable(fields: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for k, v in fields.items():
        if isinstance(v, datetime):
            out[k] = v.isoformat()
        elif hasattr(v, "model_dump"):
            out[k] = v.model_dump(mode="json")
        elif isinstance(v, list):
            out[k] = [x.model_dump(mode="json") if hasattr(x, "model_dump") else x for x in v]
        else:
            out[k] = v
    return out


def _milestone_row(m: Milestone) -> dict[str, Any]:
    row = m.model_dump(mode="json")
    row["escrow_authorization_id"] = m.escrow_authorization_id
    return row


class SupabaseStore(Repository):
    name = "supabase"

    def __init__(self, url: str, service_key: str) -> None:
        from supabase import create_client  # imported lazily so the memory path needs no network libs

        self._db = create_client(url, service_key)

    def _t(self, name: str):
        return self._db.table(name)

    # ---- contracts ----
    def _milestones_for(self, contract_id: str) -> list[Milestone]:
        rows = self._t("milestones").select("*").eq("contract_id", contract_id).order("seq").execute().data
        return [Milestone(**r) for r in rows]

    def create_contract(self, contract: Contract) -> Contract:
        row = contract.model_dump(mode="json", exclude={"milestones"})
        self._t("contracts").insert(row).execute()
        if contract.milestones:
            self._t("milestones").insert([_milestone_row(m) for m in contract.milestones]).execute()
        return self.get_contract(contract.id)  # type: ignore[return-value]

    def list_contracts(self) -> list[Contract]:
        rows = self._t("contracts").select("*").order("created_at", desc=True).execute().data
        if not rows:
            return []
        ids = [r["id"] for r in rows]
        ms_rows = self._t("milestones").select("*").in_("contract_id", ids).order("seq").execute().data
        by_contract: dict[str, list[Milestone]] = {}
        for r in ms_rows:
            by_contract.setdefault(r["contract_id"], []).append(Milestone(**r))
        return [Contract(**r, milestones=by_contract.get(r["id"], [])) for r in rows]

    def get_contract(self, contract_id: str) -> Optional[Contract]:
        rows = self._t("contracts").select("*").eq("id", contract_id).limit(1).execute().data
        if not rows:
            return None
        return Contract(**rows[0], milestones=self._milestones_for(contract_id))

    def update_contract(self, contract_id: str, **fields: Any) -> Optional[Contract]:
        self._t("contracts").update(_jsonable(fields)).eq("id", contract_id).execute()
        return self.get_contract(contract_id)

    # ---- milestones ----
    def get_milestone(self, milestone_id: str) -> Optional[Milestone]:
        rows = self._t("milestones").select("*").eq("id", milestone_id).limit(1).execute().data
        return Milestone(**rows[0]) if rows else None

    def update_milestone(self, milestone_id: str, **fields: Any) -> Optional[Milestone]:
        rows = self._t("milestones").update(_jsonable(fields)).eq("id", milestone_id).execute().data
        return Milestone(**rows[0]) if rows else self.get_milestone(milestone_id)

    # ---- submissions ----
    def add_submission(self, submission: Submission) -> Submission:
        self._t("submissions").insert(submission.model_dump(mode="json", exclude={"verdict"})).execute()
        return submission

    def add_verdict(self, verdict: Verdict) -> Verdict:
        self._t("verdicts").insert(verdict.model_dump(mode="json")).execute()
        return verdict

    def list_submissions(self, milestone_id: str) -> list[Submission]:
        rows = (
            self._t("submissions").select("*").eq("milestone_id", milestone_id)
            .order("created_at", desc=True).execute().data
        )
        if not rows:
            return []
        ids = [r["id"] for r in rows]
        v_rows = self._t("verdicts").select("*").in_("submission_id", ids).execute().data
        verdicts = {r["submission_id"]: Verdict(**r) for r in v_rows}
        return [Submission(**r, verdict=verdicts.get(r["id"])) for r in rows]

    # ---- approvals ----
    def add_approval(self, approval: Approval) -> Approval:
        self._t("approvals").insert(approval.model_dump(mode="json")).execute()
        return approval

    def get_approval(self, approval_id: str) -> Optional[Approval]:
        rows = self._t("approvals").select("*").eq("id", approval_id).limit(1).execute().data
        return Approval(**rows[0]) if rows else None

    def list_approvals(self, status: Optional[str] = None) -> list[Approval]:
        q = self._t("approvals").select("*")
        if status:
            q = q.eq("status", status)
        return [Approval(**r) for r in q.order("created_at", desc=True).execute().data]

    def transition_approval(
        self,
        approval_id: str,
        from_status: str,
        to_status: str,
        decided_by: Optional[str],
        decided_at: Optional[datetime],
    ) -> Optional[Approval]:
        # Conditional update: only succeeds if the row is still in from_status.
        rows = (
            self._t("approvals")
            .update({
                "status": to_status,
                "decided_by": decided_by,
                "decided_at": decided_at.isoformat() if decided_at else None,
            })
            .eq("id", approval_id)
            .eq("status", from_status)
            .execute()
            .data
        )
        return Approval(**rows[0]) if rows else None

    # ---- audit ----
    def add_audit(self, event: AuditEvent) -> AuditEvent:
        self._t("audit_events").insert(event.model_dump(mode="json")).execute()
        return event

    def list_audit(self, contract_id: str) -> list[AuditEvent]:
        rows = (
            self._t("audit_events").select("*").eq("contract_id", contract_id)
            .order("created_at", desc=True).order("seq", desc=True).execute().data
        )
        return [AuditEvent(**r) for r in rows]
