from __future__ import annotations

from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from app.agents import payment_agent
from app.agents.payment_agent import PaymentAgentError
from app.deps import AppContext, get_ctx
from app.models import Approval, DecideRequest

router = APIRouter(prefix="/api/approvals", tags=["approvals"])


@router.get("", response_model=list[Approval])
def list_approvals(
    status: Optional[Literal["pending", "approved", "denied"]] = Query(None),
    ctx: AppContext = Depends(get_ctx),
) -> list[Approval]:
    return ctx.store.list_approvals(status=status)


@router.post("/{approval_id}/decide", response_model=Approval)
def decide(approval_id: str, body: DecideRequest, ctx: AppContext = Depends(get_ctx)) -> Approval:
    decided_by = body.decided_by.strip()
    if not decided_by:
        raise HTTPException(422, "decided_by is required.")
    try:
        return payment_agent.execute_decision(ctx, approval_id, body.decision, decided_by)
    except PaymentAgentError as exc:
        raise HTTPException(exc.status_code, str(exc)) from exc
