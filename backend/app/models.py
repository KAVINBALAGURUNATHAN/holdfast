"""Pydantic models matching docs/API_CONTRACT.md exactly."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field

ContractStatus = Literal["draft", "active", "completed"]
PartyRole = Literal["client", "freelancer"]
MilestoneStatus = Literal["pending", "funded", "submitted", "approved", "rejected", "released", "held"]
VerdictDecision = Literal["approve", "reject", "needs_review"]
ApprovalAction = Literal["release", "hold", "refund"]
ApprovalStatus = Literal["pending", "approved", "denied"]


def new_id() -> str:
    return str(uuid.uuid4())


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Party(BaseModel):
    name: str
    role: PartyRole
    email: Optional[str] = None


class Milestone(BaseModel):
    id: str = Field(default_factory=new_id)
    contract_id: str
    seq: int
    title: str
    description: str = ""
    acceptance_criteria: list[str] = Field(default_factory=list)
    amount: float = 0.0
    due_date: Optional[str] = None
    status: MilestoneStatus = "pending"
    escrow_order_id: Optional[str] = None
    # Internal: PayPal authorization id. Persisted but never serialized to API clients.
    escrow_authorization_id: Optional[str] = Field(default=None, exclude=True)


class Contract(BaseModel):
    id: str = Field(default_factory=new_id)
    title: str
    status: ContractStatus = "draft"
    raw_text: str = ""
    parties: list[Party] = Field(default_factory=list)
    currency: str = "INR"
    total_amount: float = 0.0
    created_at: datetime = Field(default_factory=utcnow)
    milestones: list[Milestone] = Field(default_factory=list)


class CriterionResult(BaseModel):
    criterion: str
    met: bool
    evidence: str


class Verdict(BaseModel):
    id: str = Field(default_factory=new_id)
    submission_id: str
    decision: VerdictDecision
    confidence: float = Field(ge=0.0, le=1.0)
    reasoning: str
    criteria_results: list[CriterionResult] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=utcnow)


class Submission(BaseModel):
    id: str = Field(default_factory=new_id)
    milestone_id: str
    notes: str = ""
    file_name: Optional[str] = None
    extracted_text: str = ""
    created_at: datetime = Field(default_factory=utcnow)
    verdict: Optional[Verdict] = None


class Approval(BaseModel):
    id: str = Field(default_factory=new_id)
    milestone_id: str
    action: ApprovalAction
    requested_by_agent: str = "payment_agent"
    reason: str
    status: ApprovalStatus = "pending"
    decided_by: Optional[str] = None
    decided_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=utcnow)


class AuditEvent(BaseModel):
    id: str = Field(default_factory=new_id)
    contract_id: str
    milestone_id: Optional[str] = None
    actor: str
    action: str
    details: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=utcnow)


# ---- Request / response bodies ----

class FundResponse(BaseModel):
    milestone: Milestone
    order_id: str
    approve_url: str


class CaptureFundingRequest(BaseModel):
    order_id: str


class DecideRequest(BaseModel):
    decision: Literal["approved", "denied"]
    decided_by: str = Field(min_length=1, max_length=120)


class HealthResponse(BaseModel):
    ok: bool
    gemini: bool
    paypal: bool
    supabase: bool
    ocr: bool
