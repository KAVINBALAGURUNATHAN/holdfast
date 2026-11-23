from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from app.agents import payment_agent, referee_agent
from app.agents.payment_agent import PaymentAgentError
from app.deps import AppContext, get_ctx
from app.models import CaptureFundingRequest, Contract, FundResponse, Milestone, Submission
from app.routers.contracts import read_upload
from app.services import audit
from app.services.ocr import OCRUnavailableError, UploadError

router = APIRouter(prefix="/api/milestones", tags=["milestones"])

MAX_NOTES_CHARS = 20_000


def _load(ctx: AppContext, milestone_id: str) -> tuple[Contract, Milestone]:
    milestone = ctx.store.get_milestone(milestone_id)
    if not milestone:
        raise HTTPException(404, "Milestone not found.")
    contract = ctx.store.get_contract(milestone.contract_id)
    if not contract:
        raise HTTPException(404, "Contract not found.")
    return contract, milestone


def _http(exc: PaymentAgentError) -> HTTPException:
    return HTTPException(exc.status_code, str(exc))


@router.post("/{milestone_id}/fund", response_model=FundResponse)
def fund_milestone(milestone_id: str, ctx: AppContext = Depends(get_ctx)) -> FundResponse:
    contract, milestone = _load(ctx, milestone_id)
    try:
        updated, order_id, approve_url = payment_agent.create_funding_order(ctx, contract, milestone)
    except PaymentAgentError as exc:
        raise _http(exc) from exc
    return FundResponse(milestone=updated, order_id=order_id, approve_url=approve_url)


@router.post("/{milestone_id}/capture-funding", response_model=Milestone)
def capture_funding(milestone_id: str, body: CaptureFundingRequest, ctx: AppContext = Depends(get_ctx)) -> Milestone:
    contract, milestone = _load(ctx, milestone_id)
    try:
        return payment_agent.capture_funding(ctx, contract, milestone, body.order_id)
    except PaymentAgentError as exc:
        raise _http(exc) from exc


@router.post("/{milestone_id}/submit", response_model=Submission)
def submit_work(
    milestone_id: str,
    notes: str = Form(""),
    file: Optional[UploadFile] = File(None),
    ctx: AppContext = Depends(get_ctx),
) -> Submission:
    contract, milestone = _load(ctx, milestone_id)
    if milestone.status == "released":
        raise HTTPException(409, "Milestone funds have already been released; no further submissions.")
    notes = (notes or "")[:MAX_NOTES_CHARS]

    file_name: Optional[str] = None
    extracted_text = ""
    file_details: dict[str, Any] = {}
    if file is not None and file.filename:
        file_name = file.filename
        data = read_upload(file)
        try:
            result = ctx.ocr.extract(file_name, data)
            extracted_text = result.text
            file_details = {"ocr_method": result.method, "ocr_warnings": result.warnings}
        except UploadError as exc:
            raise HTTPException(exc.status_code, str(exc)) from exc
        except OCRUnavailableError as exc:
            # Proceed with notes only; the referee will see less evidence and lean to needs_review.
            file_details = {"ocr_method": "none", "ocr_error": str(exc)}
    if not notes.strip() and not extracted_text.strip() and not file_name:
        raise HTTPException(400, "Provide submission notes and/or a file.")

    submission = Submission(milestone_id=milestone.id, notes=notes, file_name=file_name, extracted_text=extracted_text)
    ctx.store.add_submission(submission)
    ctx.store.update_milestone(milestone.id, status="submitted")
    freelancer = next((p.name for p in contract.parties if p.role == "freelancer"), "freelancer")
    audit.record(ctx.store, contract_id=contract.id, milestone_id=milestone.id, actor=f"human:{freelancer}",
                 action="submission.received",
                 details={"submission_id": submission.id, "file_name": file_name, "notes_chars": len(notes),
                          "extracted_chars": len(extracted_text), **file_details})

    verdict = referee_agent.run(ctx, contract.id, milestone, submission)
    new_status = {"approve": "approved", "reject": "rejected"}.get(verdict.decision, "submitted")
    milestone = ctx.store.update_milestone(milestone.id, status=new_status) or milestone
    payment_agent.propose(ctx, contract.id, milestone, verdict)
    return submission.model_copy(update={"verdict": verdict})


@router.get("/{milestone_id}/submissions", response_model=list[Submission])
def list_submissions(milestone_id: str, ctx: AppContext = Depends(get_ctx)) -> list[Submission]:
    _load(ctx, milestone_id)
    return ctx.store.list_submissions(milestone_id)
