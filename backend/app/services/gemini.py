"""Thin wrapper around the google-genai SDK that returns validated structured JSON.

Every call is bounded: a per-attempt HTTP timeout (GEMINI_TIMEOUT_MS) plus at most one quick retry on
transient 429/5xx errors, all inside a total budget of GEMINI_TIMEOUT_MS + RETRY_EXTRA_BUDGET_S. Without a
timeout the SDK (requests, timeout=None) can block the HTTP request indefinitely when the model is
overloaded. On any failure a GeminiError is raised and the agents fall back to their heuristics.
"""
from __future__ import annotations

import json
import logging
import time
from typing import Optional, TypeVar

from pydantic import BaseModel

from app.config import Settings

log = logging.getLogger("holdfast.gemini")

T = TypeVar("T", bound=BaseModel)

RETRYABLE_CODES = {429, 500, 502, 503, 504}
RETRY_BACKOFF_S = 1.0
RETRY_EXTRA_BUDGET_S = 5.0  # extra wall-clock allowed beyond one full timeout for the single retry
MIN_RETRY_TIMEOUT_S = 3.0  # don't bother retrying with less time than this left


class GeminiError(Exception):
    pass


def _is_timeout(exc: BaseException) -> bool:
    try:
        import requests

        if isinstance(exc, requests.exceptions.Timeout):
            return True
    except ImportError:  # pragma: no cover
        pass
    return "timeout" in type(exc).__name__.lower()


class GeminiService:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.model = settings.gemini_model or "gemini-3.5-flash-lite"
        self.timeout_s = max(1.0, (settings.gemini_timeout_ms or 20_000) / 1000.0)
        self._client = None

    @property
    def enabled(self) -> bool:
        return self.settings.gemini_enabled

    def _get_client(self):
        if self._client is None:
            from google import genai

            self._client = genai.Client(
                api_key=self.settings.gemini_api_key,
                http_options={"timeout": int(self.timeout_s * 1000)},
            )
        return self._client

    def _call(self, prompt: str, schema: type[T], system_instruction: Optional[str], temperature: float,
              timeout_s: float):
        from google.genai import types

        config = types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=schema,
            temperature=temperature,
            system_instruction=system_instruction,
            http_options={"timeout": int(timeout_s * 1000)},
        )
        return self._get_client().models.generate_content(model=self.model, contents=prompt, config=config)

    def generate_json(
        self,
        prompt: str,
        schema: type[T],
        system_instruction: Optional[str] = None,
        temperature: float = 0.1,
    ) -> T:
        """Call Gemini with a JSON response schema and validate into `schema`.

        Bounded in time; raises GeminiError (with a short, key-free reason) on failure.
        """
        if not self.enabled:
            raise GeminiError("Gemini is not configured")

        start = time.monotonic()
        deadline = start + self.timeout_s + RETRY_EXTRA_BUDGET_S
        response = None
        attempt = 0
        while True:
            attempt += 1
            remaining = deadline - time.monotonic()
            attempt_timeout = min(self.timeout_s, remaining)
            t0 = time.monotonic()
            try:
                response = self._call(prompt, schema, system_instruction, temperature, attempt_timeout)
                log.info("Gemini %s ok in %.2fs (attempt %d)", self.model, time.monotonic() - t0, attempt)
                break
            except Exception as exc:
                elapsed = time.monotonic() - t0
                code = getattr(exc, "code", None)
                if _is_timeout(exc):
                    reason = f"timeout after {elapsed:.0f}s"
                elif isinstance(code, int):
                    reason = f"HTTP {code} {getattr(exc, 'status', '') or ''}".strip()
                else:
                    reason = type(exc).__name__
                # Never include request details (which could contain the key) in logs.
                log.warning("Gemini %s attempt %d failed in %.2fs: %s", self.model, attempt, elapsed, reason)
                retryable = isinstance(code, int) and code in RETRYABLE_CODES
                time_left = deadline - time.monotonic() - RETRY_BACKOFF_S
                if attempt == 1 and retryable and time_left >= MIN_RETRY_TIMEOUT_S:
                    time.sleep(RETRY_BACKOFF_S)
                    continue
                suffix = f" (after {attempt} attempts)" if attempt > 1 else ""
                raise GeminiError(f"Gemini call failed: {reason}{suffix}") from exc

        parsed = getattr(response, "parsed", None)
        if isinstance(parsed, schema):
            return parsed
        text = getattr(response, "text", None) or ""
        try:
            return schema.model_validate(json.loads(text))
        except Exception as exc:
            log.warning("Gemini returned unparseable JSON")
            raise GeminiError("Gemini returned invalid JSON") from exc
