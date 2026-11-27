"""Gemini wrapper: bounded retries/timeouts and visible heuristic fallback (no network)."""
import pytest
import requests
from pydantic import BaseModel

from app.agents import document_agent
from app.services import gemini as gemini_mod
from app.services.gemini import GeminiError, GeminiService
from tests.conftest import make_settings


class _Out(BaseModel):
    ok: bool


class _Resp:
    def __init__(self, parsed):
        self.parsed = parsed
        self.text = ""


class _ApiErr(Exception):
    def __init__(self, code):
        super().__init__(f"{code}")
        self.code = code
        self.status = "UNAVAILABLE"


def _service(monkeypatch, outcomes):
    svc = GeminiService(make_settings(gemini_api_key="test-key", gemini_timeout_ms=5000))
    calls = []

    def fake_call(prompt, schema, system_instruction, temperature, timeout_s):
        calls.append(timeout_s)
        out = outcomes[len(calls) - 1]
        if isinstance(out, Exception):
            raise out
        return _Resp(out)

    monkeypatch.setattr(svc, "_call", fake_call)
    monkeypatch.setattr(gemini_mod, "RETRY_BACKOFF_S", 0.0)
    return svc, calls


def test_retries_once_on_503_then_succeeds(monkeypatch):
    svc, calls = _service(monkeypatch, [_ApiErr(503), _Out(ok=True)])
    assert svc.generate_json("p", _Out).ok is True
    assert len(calls) == 2
    assert all(t <= 5.0 for t in calls)


def test_gives_up_after_one_retry(monkeypatch):
    svc, calls = _service(monkeypatch, [_ApiErr(503), _ApiErr(503), _Out(ok=True)])
    with pytest.raises(GeminiError, match="503.*after 2 attempts"):
        svc.generate_json("p", _Out)
    assert len(calls) == 2


def test_timeout_is_not_retried(monkeypatch):
    svc, calls = _service(monkeypatch, [requests.exceptions.ReadTimeout("slow"), _Out(ok=True)])
    with pytest.raises(GeminiError, match="timeout"):
        svc.generate_json("p", _Out)
    assert len(calls) == 1


def test_client_error_is_not_retried(monkeypatch):
    svc, calls = _service(monkeypatch, [_ApiErr(404), _Out(ok=True)])
    with pytest.raises(GeminiError, match="404"):
        svc.generate_json("p", _Out)
    assert len(calls) == 1


def test_document_agent_fallback_is_recorded(ctx, monkeypatch):
    ctx.settings.gemini_api_key = "test-key"

    def boom(*a, **k):
        raise GeminiError("Gemini call failed: timeout after 20s")

    monkeypatch.setattr(ctx.gemini, "generate_json", boom)
    text = "Contract\nClient: Acme\nFreelancer: Priya\nMilestone 1: Logo\nAmount: Rs 20,000\n- Three concepts\n"
    contract = document_agent.run(ctx, text)
    event = ctx.store.list_audit(contract.id)[-1]
    assert event.details["engine"] == "heuristic"
    assert "timeout" in event.details["fallback_reason"]
    assert event.details["gemini_model"] == ctx.gemini.model
