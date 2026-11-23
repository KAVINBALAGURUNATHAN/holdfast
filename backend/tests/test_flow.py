"""End-to-end flow with all fallbacks: seed -> fund -> submit -> approval -> decide -> audit."""
from tests.conftest import GOOD_M1_NOTES, VAGUE_M2_NOTES, fund

CONTRACT_KEYS = {"id", "title", "status", "raw_text", "parties", "currency", "total_amount", "created_at", "milestones"}
MILESTONE_KEYS = {"id", "contract_id", "seq", "title", "description", "acceptance_criteria", "amount", "due_date",
                  "status", "escrow_order_id"}
SUBMISSION_KEYS = {"id", "milestone_id", "notes", "file_name", "extracted_text", "created_at", "verdict"}
VERDICT_KEYS = {"id", "submission_id", "decision", "confidence", "reasoning", "criteria_results", "created_at"}
APPROVAL_KEYS = {"id", "milestone_id", "action", "requested_by_agent", "reason", "status", "decided_by", "decided_at",
                 "created_at"}
AUDIT_KEYS = {"id", "contract_id", "milestone_id", "actor", "action", "details", "created_at"}


def test_health_reports_fallbacks(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    body = r.json()
    assert set(body) == {"ok", "gemini", "paypal", "supabase", "ocr"}
    assert body["ok"] is True
    assert body["gemini"] is False and body["paypal"] is False and body["supabase"] is False


def test_seed_extracts_contract(client, seeded):
    c = seeded
    assert set(c) == CONTRACT_KEYS
    assert c["status"] == "draft" and c["currency"] == "INR"
    assert c["total_amount"] == 150000
    assert {(p["role"], p["name"]) for p in c["parties"]} == {
        ("client", "Sharma Organics Private Limited"), ("freelancer", "Arjun Mehta")}
    ms = c["milestones"]
    assert [m["seq"] for m in ms] == [1, 2, 3]
    assert [m["amount"] for m in ms] == [30000, 75000, 45000]
    assert [m["due_date"] for m in ms] == ["2026-12-20", "2027-01-31", "2027-02-15"]
    for m in ms:
        assert set(m) == MILESTONE_KEYS  # escrow_authorization_id must not leak
        assert m["status"] == "pending" and m["escrow_order_id"] is None
        assert len(m["acceptance_criteria"]) >= 4

    assert client.get(f"/api/contracts/{c['id']}").json()["id"] == c["id"]
    assert [x["id"] for x in client.get("/api/contracts").json()] == [c["id"]]

    audit = client.get(f"/api/contracts/{c['id']}/audit").json()
    assert audit[0]["action"] == "contract.extracted"
    assert audit[0]["actor"] == "document_agent"
    assert audit[0]["details"]["engine"] == "heuristic"
    assert set(audit[0]) == AUDIT_KEYS


def test_full_flow_release(client, seeded):
    cid = seeded["id"]
    m1 = seeded["milestones"][0]

    # Fund (simulated PayPal, intent AUTHORIZE)
    r = client.post(f"/api/milestones/{m1['id']}/fund")
    assert r.status_code == 200
    body = r.json()
    assert set(body) == {"milestone", "order_id", "approve_url"}
    assert body["order_id"].startswith("SIM-")
    assert body["milestone"]["escrow_order_id"] == body["order_id"]
    assert body["approve_url"]

    bad = client.post(f"/api/milestones/{m1['id']}/capture-funding", json={"order_id": "SIM-WRONG"})
    assert bad.status_code == 400
    r = client.post(f"/api/milestones/{m1['id']}/capture-funding", json={"order_id": body["order_id"]})
    assert r.status_code == 200
    assert r.json()["status"] == "funded"
    assert set(r.json()) == MILESTONE_KEYS
    assert client.get(f"/api/contracts/{cid}").json()["status"] == "active"
    assert client.post(f"/api/milestones/{m1['id']}/fund").status_code == 409  # already funded

    # Submit -> referee verdict -> payment agent proposal
    r = client.post(f"/api/milestones/{m1['id']}/submit", data={"notes": GOOD_M1_NOTES})
    assert r.status_code == 200, r.text
    sub = r.json()
    assert set(sub) == SUBMISSION_KEYS
    v = sub["verdict"]
    assert set(v) == VERDICT_KEYS
    assert v["decision"] == "approve", v
    assert 0 <= v["confidence"] <= 1
    assert len(v["criteria_results"]) == 4
    assert all(cr["met"] and cr["evidence"] for cr in v["criteria_results"])
    assert client.get(f"/api/contracts/{cid}").json()["milestones"][0]["status"] == "approved"

    subs = client.get(f"/api/milestones/{m1['id']}/submissions").json()
    assert len(subs) == 1 and subs[0]["verdict"]["id"] == v["id"]

    pending = client.get("/api/approvals", params={"status": "pending"}).json()
    assert len(pending) == 1
    ap = pending[0]
    assert set(ap) == APPROVAL_KEYS
    assert ap["action"] == "release" and ap["status"] == "pending"
    assert ap["requested_by_agent"] == "payment_agent" and ap["decided_by"] is None

    # Human approves -> capture
    r = client.post(f"/api/approvals/{ap['id']}/decide", json={"decision": "approved", "decided_by": "priya"})
    assert r.status_code == 200, r.text
    decided = r.json()
    assert decided["status"] == "approved" and decided["decided_by"] == "priya" and decided["decided_at"]
    assert client.get(f"/api/contracts/{cid}").json()["milestones"][0]["status"] == "released"

    # Cannot decide twice
    again = client.post(f"/api/approvals/{ap['id']}/decide", json={"decision": "denied", "decided_by": "priya"})
    assert again.status_code == 409
    assert client.get("/api/approvals", params={"status": "pending"}).json() == []
    # No more submissions after release
    assert client.post(f"/api/milestones/{m1['id']}/submit", data={"notes": "more"}).status_code == 409

    # Audit trail newest first, every step logged
    audit = client.get(f"/api/contracts/{cid}/audit").json()
    actions = [e["action"] for e in audit]
    assert actions == [
        "escrow.released", "approval.decided", "approval.requested", "verdict.issued", "submission.received",
        "escrow.funded", "escrow.order_created", "contract.extracted",
    ]
    by_action = {e["action"]: e for e in audit}
    assert by_action["escrow.released"]["details"]["simulated"] is True
    assert by_action["escrow.released"]["details"]["capture_id"].startswith("SIM-")
    assert by_action["approval.decided"]["actor"] == "human:priya"
    assert by_action["verdict.issued"]["details"]["engine"] == "heuristic"
    assert by_action["escrow.funded"]["details"]["simulated"] is True
    assert by_action["escrow.funded"]["details"]["amount_usd"] == "361.45"
    timestamps = [e["created_at"] for e in audit]
    assert timestamps == sorted(timestamps, reverse=True)


def test_vague_submission_is_held(client, seeded):
    m2 = seeded["milestones"][1]
    fund(client, m2["id"])
    r = client.post(f"/api/milestones/{m2['id']}/submit", data={"notes": VAGUE_M2_NOTES})
    assert r.status_code == 200
    v = r.json()["verdict"]
    assert v["decision"] in ("reject", "needs_review")
    ap = client.get("/api/approvals", params={"status": "pending"}).json()[0]
    assert ap["action"] == "hold"

    r = client.post(f"/api/approvals/{ap['id']}/decide", json={"decision": "approved", "decided_by": "priya"})
    assert r.status_code == 200
    m = client.get(f"/api/contracts/{seeded['id']}").json()["milestones"][1]
    assert m["status"] == "held"
    actions = [e["action"] for e in client.get(f"/api/contracts/{seeded['id']}/audit").json()]
    assert actions[0] == "escrow.held"


def test_denied_approval_moves_no_money(client, ctx, seeded, monkeypatch):
    m1 = seeded["milestones"][0]
    fund(client, m1["id"])
    client.post(f"/api/milestones/{m1['id']}/submit", data={"notes": GOOD_M1_NOTES})
    ap = client.get("/api/approvals", params={"status": "pending"}).json()[0]

    calls = []
    monkeypatch.setattr(ctx.paypal, "capture_authorization", lambda *a, **k: calls.append(a))
    monkeypatch.setattr(ctx.paypal, "void_authorization", lambda *a, **k: calls.append(a))
    r = client.post(f"/api/approvals/{ap['id']}/decide", json={"decision": "denied", "decided_by": "priya"})
    assert r.status_code == 200 and r.json()["status"] == "denied"
    assert calls == []
    assert client.get(f"/api/contracts/{seeded['id']}").json()["milestones"][0]["status"] == "approved"


def test_resubmission_supersedes_pending_approval(client, seeded):
    m1 = seeded["milestones"][0]
    fund(client, m1["id"])
    client.post(f"/api/milestones/{m1['id']}/submit", data={"notes": VAGUE_M2_NOTES})
    first = client.get("/api/approvals", params={"status": "pending"}).json()
    client.post(f"/api/milestones/{m1['id']}/submit", data={"notes": GOOD_M1_NOTES})
    pending = client.get("/api/approvals", params={"status": "pending"}).json()
    assert len(pending) == 1 and pending[0]["id"] != first[0]["id"] and pending[0]["action"] == "release"
    old = client.post(f"/api/approvals/{first[0]['id']}/decide", json={"decision": "approved", "decided_by": "x"})
    assert old.status_code == 409


def test_release_requires_funded_escrow(client, ctx, seeded):
    from app.models import Approval

    m3 = seeded["milestones"][2]  # never funded
    ap = ctx.store.add_approval(Approval(milestone_id=m3["id"], action="release", reason="test"))
    r = client.post(f"/api/approvals/{ap.id}/decide", json={"decision": "approved", "decided_by": "p"})
    assert r.status_code == 409
    assert "not funded" in r.json()["detail"]
    # Approval stays pending; nothing was decided or moved.
    assert ctx.store.get_approval(ap.id).status == "pending"


def test_not_found_and_validation(client):
    assert client.get("/api/contracts/00000000-0000-0000-0000-000000000000").status_code == 404
    assert client.get("/api/contracts/00000000-0000-0000-0000-000000000000/audit").status_code == 404
    assert client.post("/api/milestones/nope/fund").status_code == 404
    assert client.post("/api/approvals/nope/decide", json={"decision": "approved", "decided_by": "a"}).status_code == 404
    assert client.post("/api/approvals/nope/decide", json={"decision": "maybe", "decided_by": "a"}).status_code == 422
    assert client.get("/api/approvals", params={"status": "bogus"}).status_code == 422
