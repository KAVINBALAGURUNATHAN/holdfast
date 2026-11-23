"""Uploads, OCR fallbacks, heuristic engines, Gemini fallback, PayPal REST shapes and guardrails."""
import json

import httpx
import pytest

from app.agents import payment_agent, referee_agent
from app.agents.document_agent import heuristic_extract, parse_amount, parse_date
from app.agents.payment_agent import GuardrailViolation
from app.services.gemini import GeminiError
from app.services.paypal import PayPalService
from tests.conftest import BACKEND, make_settings


def _minimal_pdf(lines: list[str]) -> bytes:
    """Build a tiny valid single-page PDF with the given text lines (no extra deps)."""
    body = " ".join(f"({ln}) Tj T*" for ln in lines)
    stream = f"BT /F1 12 Tf 16 TL 72 720 Td {body} ET".encode()
    objs = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
        b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for i, body in enumerate(objs, 1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % i + body + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1)
    for off in offsets:
        out += b"%010d 00000 n \n" % off
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objs) + 1, xref)
    return bytes(out)


# ---------------- uploads ----------------

def test_upload_txt_contract(client):
    data = (BACKEND / "samples" / "sample_contract.txt").read_bytes()
    r = client.post("/api/contracts/upload", files={"file": ("contract.txt", data, "text/plain")},
                    data={"title": "Sharma Organics website"})
    assert r.status_code == 200, r.text
    c = r.json()
    assert c["title"] == "Sharma Organics website"
    assert len(c["milestones"]) == 3
    ev = client.get(f"/api/contracts/{c['id']}/audit").json()[0]
    assert ev["details"]["source_file"] == "contract.txt" and ev["details"]["ocr_method"] == "text"


def test_upload_pdf_contract(client):
    pdf = _minimal_pdf(["Client: Acme Traders", "Freelancer: Neha Rao", "Milestone 1: Logo design", "Amount: Rs. 12,000",
                        "Due Date: 2026-12-31", "Acceptance Criteria:", "- Three logo concepts delivered"])
    r = client.post("/api/contracts/upload", files={"file": ("c.pdf", pdf, "application/pdf")})
    assert r.status_code == 200, r.text
    c = r.json()
    assert c["milestones"][0]["amount"] == 12000
    ev = client.get(f"/api/contracts/{c['id']}/audit").json()[0]
    assert ev["details"]["ocr_method"] == "pdfplumber"


def test_upload_rejects_bad_type_and_size(client):
    assert client.post("/api/contracts/upload", files={"file": ("x.exe", b"MZ...", "application/octet-stream")}).status_code == 415
    assert client.post("/api/contracts/upload", files={"file": ("x.pdf", b"not a pdf", "application/pdf")}).status_code == 415
    big = b"a" * (10 * 1024 * 1024 + 1)
    assert client.post("/api/contracts/upload", files={"file": ("big.txt", big, "text/plain")}).status_code == 413


def test_image_upload_without_tesseract_gives_clear_error(client, ctx):
    if ctx.ocr.available:
        pytest.skip("Tesseract installed; fallback path not exercised")
    png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32
    r = client.post("/api/contracts/upload", files={"file": ("scan.png", png, "image/png")})
    assert r.status_code == 422
    assert "Tesseract" in r.json()["detail"]


def test_submission_with_image_and_no_tesseract_still_runs(client, ctx, seeded):
    if ctx.ocr.available:
        pytest.skip("Tesseract installed")
    m1 = seeded["milestones"][0]
    png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32
    r = client.post(f"/api/milestones/{m1['id']}/submit", data={"notes": "See screenshot"},
                    files={"file": ("shot.png", png, "image/png")})
    assert r.status_code == 200
    assert r.json()["file_name"] == "shot.png"
    assert r.json()["verdict"]["decision"] in ("needs_review", "reject")
    ev = [e for e in client.get(f"/api/contracts/{seeded['id']}/audit").json() if e["action"] == "submission.received"][0]
    assert "Tesseract" in ev["details"]["ocr_error"]


def test_submission_with_txt_file(client, seeded):
    from tests.conftest import GOOD_M1_NOTES
    m1 = seeded["milestones"][0]
    r = client.post(f"/api/milestones/{m1['id']}/submit", data={"notes": "Deliverable attached."},
                    files={"file": ("report.txt", GOOD_M1_NOTES.encode(), "text/plain")})
    assert r.status_code == 200
    assert r.json()["extracted_text"].startswith("Shared the Figma")
    assert r.json()["verdict"]["decision"] == "approve"


def test_empty_submission_rejected(client, seeded):
    m1 = seeded["milestones"][0]
    assert client.post(f"/api/milestones/{m1['id']}/submit", data={"notes": "  "}).status_code == 400


# ---------------- heuristics ----------------

def test_parsers():
    assert parse_amount("Fee: ₹1,50,000") == 150000
    assert parse_amount("INR 45,000.50") == 45000.5
    assert parse_amount("Rs. 2.5 lakh") == 250000
    assert parse_date("Due: 20/12/2026") == "2026-12-20"
    assert parse_date("by 31st January 2027") == "2027-01-31"
    assert parse_date("March 5, 2027") == "2027-03-05"
    assert parse_date("2027-02-15") == "2027-02-15"
    assert parse_date("no date") is None


def test_heuristic_without_milestone_headings():
    r = heuristic_extract("Client: Acme Pvt Ltd\nFreelancer: Ravi\nTotal fee INR 20,000 due 2027-01-10.\n- Build landing page")
    assert len(r["milestones"]) == 1
    assert r["milestones"][0]["amount"] == 20000
    assert r["milestones"][0]["acceptance_criteria"] == ["Build landing page"]


def test_heuristic_referee_decisions():
    criteria = ["Website is deployed on production domain with HTTPS enabled"]
    assert referee_agent.heuristic_referee(criteria, "")["decision"] == "needs_review"
    off_topic = "I spent the week learning about gardening, cooking recipes and travel plans for the holidays with family."
    assert referee_agent.heuristic_referee(criteria, off_topic)["decision"] == "reject"
    neg = "The website is not yet deployed on the production domain; HTTPS enabled later."
    out = referee_agent.heuristic_referee(criteria, neg)
    assert out["decision"] != "approve" and out["criteria_results"][0].met is False


# ---------------- Gemini fallback ----------------

def test_gemini_failure_falls_back_to_heuristic(client, ctx, monkeypatch):
    monkeypatch.setattr(type(ctx.gemini), "enabled", property(lambda self: True))

    def boom(*a, **k):
        raise GeminiError("Gemini call failed: TimeoutError")

    monkeypatch.setattr(ctx.gemini, "generate_json", boom)
    c = client.post("/api/demo/seed").json()
    ev = client.get(f"/api/contracts/{c['id']}/audit").json()[0]
    assert ev["details"]["engine"] == "heuristic"
    assert "TimeoutError" in ev["details"]["fallback_reason"]


def test_gemini_referee_guardrail_downgrades_inconsistent_approve():
    g = referee_agent._GVerdict(
        decision="approve", confidence=0.9, reasoning="Looks good.",
        criteria_results=[referee_agent._GCriterion(criterion="A", met=True, evidence='"a"'),
                          referee_agent._GCriterion(criterion="B", met=False, evidence="missing")],
    )
    out = referee_agent._normalize_gemini(g, ["A", "B"])
    assert out["decision"] == "needs_review"


# ---------------- payment guardrails ----------------

def test_guardrail_refuses_unapproved_rows(client, ctx, seeded):
    m1 = seeded["milestones"][0]
    client.post(f"/api/milestones/{m1['id']}/submit", data={"notes": "x y z a b c"})
    ap = ctx.store.list_approvals(status="pending")[0]
    with pytest.raises(GuardrailViolation):
        payment_agent._assert_approved(ctx, ap.id)
    with pytest.raises(GuardrailViolation):
        payment_agent._assert_approved(ctx, "missing")


# ---------------- PayPal REST (mocked transport) ----------------

def test_paypal_real_mode_request_shapes():
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append((request.method, request.url.path, request.content))
        p = request.url.path
        if p == "/v1/oauth2/token":
            return httpx.Response(200, json={"access_token": "tok", "expires_in": 3600})
        if p == "/v2/checkout/orders":
            return httpx.Response(201, json={"id": "ORDER1", "links": [
                {"rel": "self", "href": "x"}, {"rel": "payer-action", "href": "https://sandbox.paypal.com/approve"}]})
        if p == "/v2/checkout/orders/ORDER1/authorize":
            return httpx.Response(201, json={"purchase_units": [{"payments": {"authorizations": [{"id": "AUTH1", "status": "CREATED"}]}}]})
        if p == "/v2/payments/authorizations/AUTH1/capture":
            return httpx.Response(201, json={"id": "CAP1", "status": "COMPLETED"})
        if p == "/v2/payments/authorizations/AUTH1/void":
            return httpx.Response(204)
        return httpx.Response(404)

    pp = PayPalService(make_settings(paypal_client_id="id", paypal_client_secret="secret"), transport=httpx.MockTransport(handler))
    assert pp.enabled
    order = pp.create_order(milestone_id="m1", description="d", amount_inr=30000)
    assert (order.order_id, order.approve_url, order.amount_usd, order.simulated) == (
        "ORDER1", "https://sandbox.paypal.com/approve", "361.45", False)
    body = json.loads([s for s in seen if s[1] == "/v2/checkout/orders"][0][2])
    assert body["intent"] == "AUTHORIZE"
    assert body["purchase_units"][0]["amount"] == {"currency_code": "USD", "value": "361.45"}
    assert pp.authorize_order("ORDER1").id == "AUTH1"
    assert pp.capture_authorization("AUTH1").id == "CAP1"
    assert pp.void_authorization("AUTH1").status == "VOIDED"
    assert sum(1 for s in seen if s[1] == "/v1/oauth2/token") == 1  # token cached
