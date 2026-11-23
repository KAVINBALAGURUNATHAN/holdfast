"""Application configuration loaded from environment / .env via pydantic-settings."""
from __future__ import annotations

import os
import shutil
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent

MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MB
ALLOWED_EXTENSIONS = {".pdf", ".png", ".jpg", ".jpeg", ".txt"}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(BACKEND_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Gemini
    gemini_api_key: str = ""
    gemini_model: str = "gemini-2.5-flash"

    # PayPal (sandbox)
    paypal_client_id: str = ""
    paypal_client_secret: str = ""
    paypal_base_url: str = "https://api-m.sandbox.paypal.com"
    paypal_return_url: str = "http://localhost:5173/paypal/return"
    paypal_cancel_url: str = "http://localhost:5173/paypal/cancel"
    inr_per_usd: float = 83.0

    # Supabase
    supabase_url: str = ""
    supabase_service_key: str = ""

    # Misc
    cors_origins: str = "http://localhost:5173"
    tesseract_cmd: str = ""

    @property
    def gemini_enabled(self) -> bool:
        return bool(self.gemini_api_key.strip())

    @property
    def paypal_enabled(self) -> bool:
        return bool(self.paypal_client_id.strip() and self.paypal_client_secret.strip())

    @property
    def supabase_enabled(self) -> bool:
        return bool(self.supabase_url.strip() and self.supabase_service_key.strip())

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    def resolved_tesseract_cmd(self) -> str | None:
        """Path to the tesseract binary if one is available, else None."""
        if self.tesseract_cmd.strip():
            cmd = self.tesseract_cmd.strip()
            if os.path.isfile(cmd) or shutil.which(cmd):
                return cmd
            return None
        return shutil.which("tesseract")


@lru_cache
def get_settings() -> Settings:
    return Settings()
