"""Thin wrapper around the google-genai SDK that returns validated structured JSON."""
from __future__ import annotations

import json
import logging
from typing import Optional, TypeVar

from pydantic import BaseModel

from app.config import Settings

log = logging.getLogger("holdfast.gemini")

T = TypeVar("T", bound=BaseModel)


class GeminiError(Exception):
    pass


class GeminiService:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.model = settings.gemini_model or "gemini-2.5-flash"
        self._client = None

    @property
    def enabled(self) -> bool:
        return self.settings.gemini_enabled

    def _get_client(self):
        if self._client is None:
            from google import genai

            self._client = genai.Client(api_key=self.settings.gemini_api_key)
        return self._client

    def generate_json(
        self,
        prompt: str,
        schema: type[T],
        system_instruction: Optional[str] = None,
        temperature: float = 0.1,
    ) -> T:
        """Call Gemini with a JSON response schema and validate into `schema`."""
        if not self.enabled:
            raise GeminiError("Gemini is not configured")
        try:
            from google.genai import types

            config = types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=schema,
                temperature=temperature,
                system_instruction=system_instruction,
            )
            response = self._get_client().models.generate_content(
                model=self.model, contents=prompt, config=config
            )
        except Exception as exc:
            # Never include request details (which could contain the key) in logs.
            log.warning("Gemini call failed: %s", type(exc).__name__)
            raise GeminiError(f"Gemini call failed: {type(exc).__name__}") from exc

        parsed = getattr(response, "parsed", None)
        if isinstance(parsed, schema):
            return parsed
        text = getattr(response, "text", None) or ""
        try:
            return schema.model_validate(json.loads(text))
        except Exception as exc:
            log.warning("Gemini returned unparseable JSON")
            raise GeminiError("Gemini returned invalid JSON") from exc
