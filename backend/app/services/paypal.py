"""PayPal Sandbox escrow via Orders v2 (intent AUTHORIZE) + Payments v2 authorizations.

Escrow model: funding = an *authorized* (not captured) order. Release = capture the
authorization. Refund before release = void the authorization. Hold = keep it authorized.

Without PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET a deterministic simulator is used and
all ids are prefixed with `SIM-`.
"""
from __future__ import annotations

import logging
import threading
import time
import uuid
from dataclasses import dataclass
from typing import Optional
from urllib.parse import urlencode

import httpx

from app.config import Settings

log = logging.getLogger("holdfast.paypal")


class PayPalError(Exception):
    pass


@dataclass
class OrderResult:
    order_id: str
    approve_url: str
    amount_usd: str
    simulated: bool


@dataclass
class EscrowResult:
    id: str
    status: str
    simulated: bool


def inr_to_usd(amount_inr: float, inr_per_usd: float) -> str:
    rate = inr_per_usd if inr_per_usd > 0 else 83.0
    usd = max(round(float(amount_inr) / rate, 2), 0.01)
    return f"{usd:.2f}"


class PayPalService:
    def __init__(self, settings: Settings, transport: Optional[httpx.BaseTransport] = None) -> None:
        self.settings = settings
        self.base_url = settings.paypal_base_url.rstrip("/")
        self._transport = transport
        self._token: Optional[str] = None
        self._token_expiry = 0.0
        self._lock = threading.Lock()

    @property
    def enabled(self) -> bool:
        return self.settings.paypal_enabled

    # ---- HTTP helpers ----
    def _client(self) -> httpx.Client:
        return httpx.Client(base_url=self.base_url, timeout=20.0, transport=self._transport)

    def _access_token(self) -> str:
        with self._lock:
            if self._token and time.time() < self._token_expiry - 60:
                return self._token
            with self._client() as c:
                resp = c.post(
                    "/v1/oauth2/token",
                    data={"grant_type": "client_credentials"},
                    auth=(self.settings.paypal_client_id, self.settings.paypal_client_secret),
                    headers={"Accept": "application/json"},
                )
            if resp.status_code != 200:
                raise PayPalError(f"PayPal OAuth failed (HTTP {resp.status_code})")
            body = resp.json()
            self._token = body["access_token"]
            self._token_expiry = time.time() + int(body.get("expires_in", 300))
            return self._token

    def _post(self, path: str, json_body: Optional[dict] = None, idempotency_key: Optional[str] = None) -> httpx.Response:
        headers = {
            "Authorization": f"Bearer {self._access_token()}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }
        if idempotency_key:
            headers["PayPal-Request-Id"] = idempotency_key
        with self._client() as c:
            resp = c.post(path, json=json_body if json_body is not None else {}, headers=headers)
        if resp.status_code >= 400:
            debug_id = resp.headers.get("PayPal-Debug-Id", "")
            issue = ""
            try:
                details = resp.json().get("details") or []
                issue = details[0].get("issue", "") if details else resp.json().get("name", "")
            except Exception:
                pass
            raise PayPalError(f"PayPal {path} failed (HTTP {resp.status_code} {issue} debug_id={debug_id})".strip())
        return resp

    # ---- Escrow operations ----
    def create_order(self, *, milestone_id: str, description: str, amount_inr: float) -> OrderResult:
        amount_usd = inr_to_usd(amount_inr, self.settings.inr_per_usd)
        if not self.enabled:
            order_id = f"SIM-ORDER-{uuid.uuid4().hex[:16].upper()}"
            qs = urlencode({"token": order_id, "simulated": "true", "milestone_id": milestone_id})
            sep = "&" if "?" in self.settings.paypal_return_url else "?"
            return OrderResult(order_id, f"{self.settings.paypal_return_url}{sep}{qs}", amount_usd, True)

        body = {
            "intent": "AUTHORIZE",
            "purchase_units": [{
                "reference_id": milestone_id,
                "custom_id": milestone_id,
                "description": (description or "HoldFast milestone escrow")[:127],
                "amount": {"currency_code": "USD", "value": amount_usd},
            }],
            "payment_source": {"paypal": {"experience_context": {
                "brand_name": "HoldFast",
                "user_action": "PAY_NOW",
                "shipping_preference": "NO_SHIPPING",
                "return_url": self.settings.paypal_return_url,
                "cancel_url": self.settings.paypal_cancel_url,
            }}},
        }
        data = self._post("/v2/checkout/orders", body, idempotency_key=f"order-{milestone_id}-{uuid.uuid4().hex[:8]}").json()
        links = {link.get("rel"): link.get("href") for link in data.get("links", [])}
        approve_url = links.get("payer-action") or links.get("approve")
        if not approve_url:
            raise PayPalError("PayPal order created without an approval link")
        return OrderResult(data["id"], approve_url, amount_usd, False)

    def authorize_order(self, order_id: str) -> EscrowResult:
        """After buyer approval: authorize the order. Returns the authorization id."""
        if not self.enabled or order_id.startswith("SIM-"):
            return EscrowResult(f"SIM-AUTH-{uuid.uuid4().hex[:16].upper()}", "CREATED", True)
        data = self._post(f"/v2/checkout/orders/{order_id}/authorize", {}, idempotency_key=f"auth-{order_id}").json()
        try:
            auth = data["purchase_units"][0]["payments"]["authorizations"][0]
        except (KeyError, IndexError) as exc:
            raise PayPalError("PayPal authorize response missing authorization") from exc
        return EscrowResult(auth["id"], auth.get("status", "CREATED"), False)

    def capture_authorization(self, authorization_id: str) -> EscrowResult:
        if not self.enabled or authorization_id.startswith("SIM-"):
            return EscrowResult(f"SIM-CAPTURE-{uuid.uuid4().hex[:16].upper()}", "COMPLETED", True)
        data = self._post(
            f"/v2/payments/authorizations/{authorization_id}/capture",
            {"final_capture": True},
            idempotency_key=f"capture-{authorization_id}",
        ).json()
        return EscrowResult(data.get("id", ""), data.get("status", ""), False)

    def void_authorization(self, authorization_id: str) -> EscrowResult:
        if not self.enabled or authorization_id.startswith("SIM-"):
            return EscrowResult(authorization_id, "VOIDED", True)
        self._post(f"/v2/payments/authorizations/{authorization_id}/void", None, idempotency_key=f"void-{authorization_id}")
        return EscrowResult(authorization_id, "VOIDED", False)
