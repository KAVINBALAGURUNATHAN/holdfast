"""PayPal return/cancel URL building, amount validation, error surfacing and the refund -> void path.

All tests run without network: simulated mode or httpx.MockTransport.
"""
import json
import math
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest

from app.models import Approval
from app.services.paypal import PayPalError, PayPalService, inr_to_usd, with_query
from tests.conftest import fund, make_settings

RETURN = "http://localhost:5174/paypal/return"
CANCEL = "http://localhost:5174/paypal/cancel"


def _qs(url: str) -> dict[str, str]:
    return {k: v[0] for k, v in parse_qs(urlsplit(url).query).items()}


def test_with_query_merges_and_replaces():
    assert with_query(RETURN, milestone_id="m1") == f"{RETURN}?milestone_id=m1"
    url = with_query(f"{RETURN}?a=1&milestone_id=old", milestone_id="m 2", contract_id="c1", skip=None)
    assert urlsplit(url).path == "/paypal/return"
    assert _qs(url) == {"a": "1", "milestone_id": "m 2", "contract_id": "c1"}


def test_simulated_order_return_url_carries_milestone_and_contract():
    pp = PayPalService(make_settings(paypal_return_url=RETURN, paypal_cancel_url=CANCEL))
    assert not pp.enabled
    order = pp.create_order(milestone_id="m1", description="d", amount_inr=8300, contract_id="c1")
    assert order.simulated and order.order_id.startswith("SIM-ORDER-")
    assert order.approve_url.startswith(RETURN + "?")
    assert _qs(order.approve_url) == {"milestone_id": "m1", "contract_id": "c1", "token": order.order_id,
                                      "simulated": "true"}
    ret, cancel = pp.redirect_urls("m1", "c1")
    assert _qs(ret) == _qs(cancel) == {"milestone_id": "m1", "contract_id": "c1"}
    assert cancel.startswith(CANCEL + "?")
    # contract id is optional
    assert _qs(pp.redirect_urls("m1")[0]) == {"milestone_id": "m1"}


def test_real_order_sends_per_order_redirect_urls():
    sent = {}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/oauth2/token":
            return httpx.Response(200, json={"access_token": "tok", "expires_in": 3600})
        sent["body"] = json.loads(request.content)
        return httpx.Response(201, json={"id": "ORDER9", "links": [{"rel": "payer-action", "href": "https://pp/approve"}]})

    pp = PayPalService(make_settings(paypal_client_id="id", paypal_client_secret="secret", paypal_return_url=RETURN,
                                     paypal_cancel_url=CANCEL), transport=httpx.MockTransport(handler))
    pp.create_order(milestone_id="m1", description="d", amount_inr=100, contract_id="c1")
    ctx_ = sent["body"]["payment_source"]["paypal"]["experience_context"]
    assert ctx_["return_url"] == f"{RETURN}?milestone_id=m1&contract_id=c1"
    assert ctx_["cancel_url"] == f"{CANCEL}?milestone_id=m1&contract_id=c1"
    assert sent["body"]["purchase_units"][0]["amount"] == {"currency_code": "USD", "value": "1.20"}


def test_fund_api_returns_return_url_that_funds_the_milestone(client, seeded):
    m1 = seeded["milestones"][0]
    r = client.post(f"/api/milestones/{m1['id']}/fund")
    assert r.status_code == 200, r.text
    q = _qs(r.json()["approve_url"])
    assert q["milestone_id"] == m1["id"] and q["contract_id"] == seeded["id"] and q["token"] == r.json()["order_id"]
    # What the frontend return page does: capture with ?token for ?milestone_id, twice (StrictMode / refresh).
    for _ in range(2):
        r2 = client.post(f"/api/milestones/{q['milestone_id']}/capture-funding", json={"order_id": q["token"]})
        assert r2.status_code == 200, r2.text
        assert r2.json()["status"] == "funded"
    # A stale token from an older order is rejected cleanly.
    r3 = client.post(f"/api/milestones/{m1['id']}/capture-funding", json={"order_id": "SIM-ORDER-OTHER"})
    assert r3.status_code == 400


@pytest.mark.parametrize("inr,usd", [(30000, "361.45"), (1, "0.01"), (0.4, "0.01"), (83, "1.00"), (124.5, "1.50")])
def test_inr_to_usd_valid_amounts(inr, usd):
    assert inr_to_usd(inr, 83.0) == usd


@pytest.mark.parametrize("bad", [0, -5, math.nan, math.inf])
def test_inr_to_usd_rejects_invalid(bad):
    with pytest.raises(PayPalError):
        inr_to_usd(bad, 83.0)


def _failing_paypal():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/oauth2/token":
            return httpx.Response(200, json={"access_token": "tok", "expires_in": 3600})
        return httpx.Response(422, headers={"PayPal-Debug-Id": "dbg123"},
                              json={"name": "UNPROCESSABLE_ENTITY", "details": [{"issue": "ORDER_NOT_APPROVED"}]})

    return PayPalService(make_settings(paypal_client_id="id-SECRETID", paypal_client_secret="pw-SECRETPW"),
                         transport=httpx.MockTransport(handler))


def test_paypal_errors_are_clean_and_keep_debug_id():
    pp = _failing_paypal()
    for call in (lambda: pp.authorize_order("O1"), lambda: pp.capture_authorization("A1"),
                 lambda: pp.void_authorization("A1")):
        with pytest.raises(PayPalError) as ei:
            call()
        msg = str(ei.value)
        assert "422" in msg and "ORDER_NOT_APPROVED" in msg and "debug_id=dbg123" in msg
        assert "SECRET" not in msg


def test_paypal_network_error_becomes_paypal_error():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("boom", request=request)

    pp = PayPalService(make_settings(paypal_client_id="id", paypal_client_secret="pw"), transport=httpx.MockTransport(handler))
    with pytest.raises(PayPalError, match="Could not reach PayPal"):
        pp.create_order(milestone_id="m1", description="d", amount_inr=100)


def test_capture_funding_paypal_error_is_502_with_debug_id(client, ctx, seeded, monkeypatch):
    m1 = seeded["milestones"][0]
    ctx.store.update_milestone(m1["id"], escrow_order_id="REALORDER1")
    monkeypatch.setattr(ctx, "paypal", _failing_paypal())
    r = client.post(f"/api/milestones/{m1['id']}/capture-funding", json={"order_id": "REALORDER1"})
    assert r.status_code == 502
    assert "debug_id=dbg123" in r.json()["detail"] and "SECRET" not in r.json()["detail"]
    assert ctx.store.get_milestone(m1["id"]).status == "pending"


def test_refund_approval_voids_authorization(client, ctx, seeded, monkeypatch):
    m1 = seeded["milestones"][0]
    funded = fund(client, m1["id"])
    assert funded["status"] == "funded"
    auth_id = ctx.store.get_milestone(m1["id"]).escrow_authorization_id
    calls = []
    real_void = ctx.paypal.void_authorization
    monkeypatch.setattr(ctx.paypal, "void_authorization", lambda a: calls.append(a) or real_void(a))
    approval = Approval(milestone_id=m1["id"], action="refund", requested_by_agent="payment_agent", reason="test")
    ctx.store.add_approval(approval)
    r = client.post(f"/api/approvals/{approval.id}/decide", json={"decision": "approved", "decided_by": "Tester"})
    assert r.status_code == 200, r.text
    assert calls == [auth_id]
    assert ctx.store.get_milestone(m1["id"]).status == "rejected"
    events = client.get(f"/api/contracts/{seeded['id']}/audit").json()
    voided = [e for e in events if e["action"] == "escrow.voided"]
    assert voided and voided[0]["details"]["void_status"] == "VOIDED"


def test_refund_paypal_failure_resets_approval_to_pending(client, ctx, seeded, monkeypatch):
    m1 = seeded["milestones"][0]
    fund(client, m1["id"])
    ctx.store.update_milestone(m1["id"], escrow_authorization_id="REALAUTH1")
    monkeypatch.setattr(ctx, "paypal", _failing_paypal())
    approval = Approval(milestone_id=m1["id"], action="refund", requested_by_agent="payment_agent", reason="test")
    ctx.store.add_approval(approval)
    r = client.post(f"/api/approvals/{approval.id}/decide", json={"decision": "approved", "decided_by": "Tester"})
    assert r.status_code == 502 and "debug_id=dbg123" in r.json()["detail"]
    assert ctx.store.get_approval(approval.id).status == "pending"
    assert ctx.store.get_milestone(m1["id"]).status == "funded"
