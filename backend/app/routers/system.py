from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from app.agents import document_agent
from app.config import BACKEND_DIR
from app.deps import AppContext, get_ctx
from app.models import Contract, HealthResponse

router = APIRouter(prefix="/api", tags=["system"])

SAMPLE_CONTRACT = BACKEND_DIR / "samples" / "sample_contract.txt"


@router.get("/health", response_model=HealthResponse)
def health(ctx: AppContext = Depends(get_ctx)) -> HealthResponse:
    return HealthResponse(
        ok=True,
        gemini=ctx.gemini.enabled,
        paypal=ctx.paypal.enabled,
        supabase=ctx.store.name == "supabase",
        ocr=ctx.ocr.available,
    )


@router.post("/demo/seed", response_model=Contract)
def seed_demo(ctx: AppContext = Depends(get_ctx)) -> Contract:
    if not SAMPLE_CONTRACT.is_file():
        raise HTTPException(500, "Sample contract file is missing.")
    text = SAMPLE_CONTRACT.read_text(encoding="utf-8")
    return document_agent.run(ctx, text, source={"source_file": SAMPLE_CONTRACT.name, "ocr_method": "text", "seeded": True})
