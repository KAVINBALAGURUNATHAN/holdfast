from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from app.agents import document_agent
from app.config import MAX_UPLOAD_BYTES
from app.deps import AppContext, get_ctx
from app.models import AuditEvent, Contract
from app.services.ocr import OCRUnavailableError, UploadError

router = APIRouter(prefix="/api/contracts", tags=["contracts"])


def read_upload(file: UploadFile) -> bytes:
    data = file.file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "File too large (max 10 MB).")
    return data


@router.post("/upload", response_model=Contract)
def upload_contract(
    file: UploadFile = File(...),
    title: Optional[str] = Form(None),
    ctx: AppContext = Depends(get_ctx),
) -> Contract:
    data = read_upload(file)
    filename = file.filename or "upload"
    try:
        result = ctx.ocr.extract(filename, data)
    except UploadError as exc:
        raise HTTPException(exc.status_code, str(exc)) from exc
    except OCRUnavailableError as exc:
        raise HTTPException(422, str(exc)) from exc
    if not result.text.strip():
        raise HTTPException(422, "No text could be extracted from the uploaded file.")
    return document_agent.run(
        ctx,
        result.text,
        title=(title or "").strip() or None,
        source={"source_file": filename, "ocr_method": result.method, "ocr_warnings": result.warnings,
                "text_chars": len(result.text)},
    )


@router.get("", response_model=list[Contract])
def list_contracts(ctx: AppContext = Depends(get_ctx)) -> list[Contract]:
    return ctx.store.list_contracts()


@router.get("/{contract_id}", response_model=Contract)
def get_contract(contract_id: str, ctx: AppContext = Depends(get_ctx)) -> Contract:
    contract = ctx.store.get_contract(contract_id)
    if not contract:
        raise HTTPException(404, "Contract not found.")
    return contract


@router.get("/{contract_id}/audit", response_model=list[AuditEvent])
def get_audit(contract_id: str, ctx: AppContext = Depends(get_ctx)) -> list[AuditEvent]:
    if not ctx.store.get_contract(contract_id):
        raise HTTPException(404, "Contract not found.")
    return ctx.store.list_audit(contract_id)
