"""Payment agent: manages escrow and proposes release/hold. It NEVER moves money on its own.

Irreversible operations (capture / void) are only executed from `execute_decision`, and only after
the Approval row has been atomically transitioned to "approved" by a human decision and re-read from
the store (`_assert_approved`).
"""
from __future__ import annotations

import logging
from typing import Any

from app.deps import AppContext
from app.models import Approval, Contract, Milestone, Verdict, utcnow
from app.services import audit
from app.services.paypal import PayPalError, inr_to_usd

log = logging.getLogger("holdfast.payment_agent")

ACTOR = "payment_agent"


class PaymentAgentError(Exception):
    def __init__(self, message: str, status_code: int = 409) -> None:
        super().__init__(message)
        self.status_code = status_code


class GuardrailViolation(PaymentAgentError):
    def __init__(self, message: str) -> None:
        super().__init__(message, 403)


# --------------------------------------------------------------------------- #
# Funding (escrow = authorized, not captured)
# --------------------------------------------------------------------------- #

def create_funding_order(ctx: AppContext, contract: Contract, milestone: Milestone) -> tuple[Milestone, str, str]:
    if milestone.status != "pending" or milestone.escrow_authorization_id:
        raise PaymentAgentError(f"Milestone is already funded or in progress (status: {milestone.status}).")
    if milestone.amount <= 0:
        raise PaymentAgentError("Milestone has no amount to fund.", 400)
    try:
        order = ctx.paypal.create_order(
            milestone_id=milestone.id,
            description=f"{contract.title} - {milestone.title}",
            amount_inr=milestone.amount,
        )
    except PayPalError as exc:
        audit.record(ctx.store, contract_id=contract.id, milestone_id=milestone.id, actor=ACTOR,
                     action="escrow.error", details={"operation": "create_order", "error": str(exc)})
        raise PaymentAgentError(str(exc), 502) from exc

    updated = ctx.store.update_milestone(milestone.id, escrow_order_id=order.order_id)
    audit.record(
        ctx.store, contract_id=contract.id, milestone_id=milestone.id, actor=ACTOR, action="escrow.order_created",
        details={"order_id": order.order_id, "intent": "AUTHORIZE", "amount_inr": milestone.amount,
                 "amount_usd": order.amount_usd, "inr_per_usd": ctx.settings.inr_per_usd, "simulated": order.simulated},
    )
    return updated, order.order_id, order.approve_url  # type: ignore[return-value]


def capture_funding(ctx: AppContext, contract: Contract, milestone: Milestone, order_id: str) -> Milestone:
    if not milestone.escrow_order_id or order_id != milestone.escrow_order_id:
        raise PaymentAgentError("order_id does not match this milestone's escrow order.", 400)
    if milestone.escrow_authorization_id:
        return milestone  # idempotent: already authorized
    try:
        auth = ctx.paypal.authorize_order(order_id)
    except PayPalError as exc:
        audit.record(ctx.store, contract_id=contract.id, milestone_id=milestone.id, actor=ACTOR,
                     action="escrow.error", details={"operation": "authorize_order", "order_id": order_id, "error": str(exc)})
        raise PaymentAgentError(str(exc), 502) from exc

    updated = ctx.store.update_milestone(milestone.id, status="funded", escrow_authorization_id=auth.id)
    if contract.status == "draft":
        ctx.store.update_contract(contract.id, status="active")
    audit.record(
        ctx.store, contract_id=contract.id, milestone_id=milestone.id, actor=ACTOR, action="escrow.funded",
        details={"order_id": order_id, "authorization_id": auth.id, "authorization_status": auth.status,
                 "amount_inr": milestone.amount, "amount_usd": inr_to_usd(milestone.amount, ctx.settings.inr_per_usd),
                 "simulated": auth.simulated},
    )
    return updated  # type: ignore[return-value]


# --------------------------------------------------------------------------- #
# Proposals
# --------------------------------------------------------------------------- #

def propose(ctx: AppContext, contract_id: str, milestone: Milestone, verdict: Verdict) -> Approval:
    """Turn an advisory verdict into a pending Approval for a human. Moves no money."""
    # Supersede older pending proposals for this milestone so stale ones cannot be executed.
    for old in ctx.store.list_approvals(status="pending"):
        if old.milestone_id == milestone.id:
            if ctx.store.transition_approval(old.id, "pending", "denied", f"{ACTOR}:superseded", utcnow()):
                audit.record(ctx.store, contract_id=contract_id, milestone_id=milestone.id, actor=ACTOR,
                             action="approval.superseded", details={"approval_id": old.id, "action": old.action})

    met = sum(r.met for r in verdict.criteria_results)
    total = len(verdict.criteria_results)
    if verdict.decision == "approve":
        action = "release"
        reason = (f"Referee approved ({met}/{total} criteria met, confidence {verdict.confidence:.0%}). "
                  f"Proposing release of escrowed INR {milestone.amount:,.2f}.")
    else:
        action = "hold"
        label = "rejected the submission" if verdict.decision == "reject" else "flagged the submission for human review"
        reason = (f"Referee {label} ({met}/{total} criteria met, confidence {verdict.confidence:.0%}). "
                  "Proposing to keep funds held in escrow.")
    funded = bool(milestone.escrow_authorization_id)
    if not funded:
        reason += " Note: this milestone's escrow is not funded yet."

    approval = Approval(milestone_id=milestone.id, action=action, requested_by_agent=ACTOR, reason=reason)
    ctx.store.add_approval(approval)
    audit.record(
        ctx.store, contract_id=contract_id, milestone_id=milestone.id, actor=ACTOR, action="approval.requested",
        details={"approval_id": approval.id, "proposed_action": action, "verdict_id": verdict.id,
                 "verdict_decision": verdict.decision, "confidence": verdict.confidence,
                 "escrow_order_id": milestone.escrow_order_id, "escrow_funded": funded,
                 "amount_inr": milestone.amount, "requires_human_approval": True},
    )
    return approval


# --------------------------------------------------------------------------- #
# Execution after a human decision
# --------------------------------------------------------------------------- #

def _assert_approved(ctx: AppContext, approval_id: str) -> Approval:
    """Hard guardrail: re-read the Approval row; refuse unless a human approved it."""
    row = ctx.store.get_approval(approval_id)
    if row is None or row.status != "approved" or not row.decided_by:
        raise GuardrailViolation("Refusing to move money without an approved Approval row.")
    return row


def _check_preconditions(approval: Approval, milestone: Milestone) -> None:
    if milestone.status == "released":
        raise PaymentAgentError("Milestone funds have already been released.")
    if approval.action in ("release", "refund") and not milestone.escrow_authorization_id:
        raise PaymentAgentError("Milestone escrow is not funded; nothing to release or refund.")


def execute_decision(ctx: AppContext, approval_id: str, decision: str, decided_by: str) -> Approval:
    approval = ctx.store.get_approval(approval_id)
    if approval is None:
        raise PaymentAgentError("Approval not found.", 404)
    if approval.status != "pending":
        raise PaymentAgentError(f"Approval has already been decided ({approval.status}).")
    milestone = ctx.store.get_milestone(approval.milestone_id)
    if milestone is None:
        raise PaymentAgentError("Milestone not found.", 404)
    contract_id = milestone.contract_id
    human = f"human:{decided_by}"

    if decision == "approved":
        _check_preconditions(approval, milestone)
    to_status = "approved" if decision == "approved" else "denied"
    decided = ctx.store.transition_approval(approval_id, "pending", to_status, decided_by, utcnow())
    if decided is None:
        raise PaymentAgentError("Approval has already been decided.")

    audit.record(ctx.store, contract_id=contract_id, milestone_id=milestone.id, actor=human, action="approval.decided",
                 details={"approval_id": approval_id, "action": approval.action, "decision": to_status})
    if to_status == "denied":
        return decided

    # ---- money movement: only past this guardrail ----
    approved_row = _assert_approved(ctx, approval_id)
    details: dict[str, Any] = {"approval_id": approval_id, "approved_by": approved_row.decided_by,
                               "order_id": milestone.escrow_order_id, "amount_inr": milestone.amount}
    try:
        if approval.action == "release":
            res = ctx.paypal.capture_authorization(milestone.escrow_authorization_id)  # type: ignore[arg-type]
            ctx.store.update_milestone(milestone.id, status="released")
            details.update(capture_id=res.id, capture_status=res.status, simulated=res.simulated,
                           authorization_id=milestone.escrow_authorization_id)
            event = "escrow.released"
        elif approval.action == "refund":
            res = ctx.paypal.void_authorization(milestone.escrow_authorization_id)  # type: ignore[arg-type]
            ctx.store.update_milestone(milestone.id, status="rejected")
            details.update(void_status=res.status, simulated=res.simulated, authorization_id=res.id)
            event = "escrow.voided"
        else:  # hold: keep the authorization in place, no PayPal call
            ctx.store.update_milestone(milestone.id, status="held")
            details.update(simulated=not ctx.paypal.enabled or (milestone.escrow_order_id or "").startswith("SIM-"),
                           authorization_id=milestone.escrow_authorization_id,
                           note="Funds remain authorized (not captured) in escrow.")
            event = "escrow.held"
    except PayPalError as exc:
        # Roll the approval back to pending so the human can retry; nothing moved.
        ctx.store.transition_approval(approval_id, "approved", "pending", None, None)
        audit.record(ctx.store, contract_id=contract_id, milestone_id=milestone.id, actor=ACTOR, action="escrow.error",
                     details={**details, "operation": approval.action, "error": str(exc), "approval_reset_to": "pending"})
        raise PaymentAgentError(str(exc), 502) from exc

    audit.record(ctx.store, contract_id=contract_id, milestone_id=milestone.id, actor=ACTOR, action=event, details=details)

    contract = ctx.store.get_contract(contract_id)
    if contract and contract.milestones and all(m.status == "released" for m in contract.milestones):
        ctx.store.update_contract(contract_id, status="completed")
        audit.record(ctx.store, contract_id=contract_id, actor=ACTOR, action="contract.completed",
                     details={"total_amount": contract.total_amount})
    return approved_row
