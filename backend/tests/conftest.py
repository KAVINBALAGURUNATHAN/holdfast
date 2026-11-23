import os
import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

# Force every integration off so tests exercise the zero-key fallbacks, regardless of local .env.
for _k in ("GEMINI_API_KEY", "PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET", "SUPABASE_URL", "SUPABASE_SERVICE_KEY"):
    os.environ[_k] = ""

from fastapi.testclient import TestClient  # noqa: E402

from app.config import Settings  # noqa: E402
from app.main import create_app  # noqa: E402
from app.store.memory_store import MemoryStore  # noqa: E402


def make_settings(**overrides) -> Settings:
    base = dict(
        _env_file=None,
        gemini_api_key="",
        paypal_client_id="",
        paypal_client_secret="",
        supabase_url="",
        supabase_service_key="",
        cors_origins="http://localhost:5173",
        inr_per_usd=83.0,
    )
    base.update(overrides)
    return Settings(**base)


@pytest.fixture
def app():
    return create_app(make_settings(), MemoryStore())


@pytest.fixture
def client(app):
    with TestClient(app) as c:
        yield c


@pytest.fixture
def ctx(app):
    return app.state.ctx


@pytest.fixture
def seeded(client):
    resp = client.post("/api/demo/seed")
    assert resp.status_code == 200, resp.text
    return resp.json()


GOOD_M1_NOTES = (
    "Shared the Figma prototype link covering the home page, product listing page, product detail page, "
    "cart page and checkout pages: https://figma.com/proto/sharma-organics. "
    "All designs are responsive, with separate mobile and desktop layouts for every page. "
    "Brand colours and the logo from the brand guide are applied consistently across all screens. "
    "Feedback from the first review round has been incorporated (header spacing and CTA colour)."
)

VAGUE_M2_NOTES = (
    "Work is mostly done, will share more details soon. Some features are still pending on staging, "
    "please check later and let me know what you think about it."
)


def fund(client, milestone_id):
    r = client.post(f"/api/milestones/{milestone_id}/fund")
    assert r.status_code == 200, r.text
    order_id = r.json()["order_id"]
    r2 = client.post(f"/api/milestones/{milestone_id}/capture-funding", json={"order_id": order_id})
    assert r2.status_code == 200, r2.text
    return r2.json()
