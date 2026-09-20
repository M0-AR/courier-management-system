"""Hardening contract: security headers, rate limiting, events, stats, seeder.

Markers: unit (pure logic) vs integration (full ASGI stack) per 2026 voted
two-tier pattern. Run tiers separately: pytest -m unit / -m integration.
"""
import os
import subprocess
import sys

import pytest

os.environ.setdefault("DATABASE_URL", "sqlite:///./test_contract.db")
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from fastapi.testclient import TestClient  # noqa: E402

from app.database import Base, engine  # noqa: E402
from app.main import _over_limit, app  # noqa: E402

client = TestClient(app)


@pytest.fixture(autouse=True)
def fresh_db():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    yield


def _book(**over):
    payload = {
        "customer_name": "Harden",
        "phone": "+15550101010",
        "parcel_type": "Documents",
        "weight_kg": 1,
        "source": "Austin",
        "destination": "Denver",
    }
    payload.update(over)
    return client.post("/api/couriers", json=payload)


@pytest.mark.integration
def test_security_headers_on_api_responses():
    r = client.get("/api/stats")
    assert r.headers["X-Content-Type-Options"] == "nosniff"
    assert r.headers["X-Frame-Options"] == "DENY"
    assert r.headers["Referrer-Policy"] == "strict-origin-when-cross-origin"
    assert "camera=()" in r.headers["Permissions-Policy"]
    assert r.headers["X-Request-ID"]


@pytest.mark.integration
def test_request_id_passthrough():
    r = client.get("/api/health", headers={"X-Request-ID": "e2e-probe-123"})
    assert r.headers["X-Request-ID"] == "e2e-probe-123"


@pytest.mark.unit
def test_rate_limiter_blocks_and_resets(monkeypatch):
    import app.main as main

    monkeypatch.setattr(main, "RATE_LIMIT_PER_MINUTE", 3)
    monkeypatch.setattr(main, "_redis_client", None)  # force memory path
    main._RATE_MEM.clear()
    assert not _over_limit("9.9.9.9")
    assert not _over_limit("9.9.9.9")
    assert not _over_limit("9.9.9.9")
    assert _over_limit("9.9.9.9")  # 4th inside the window → blocked
    assert not _over_limit("8.8.8.8")  # other IPs unaffected


@pytest.mark.integration
def test_events_ordered_and_immutable():
    cid = _book().json()["id"]
    client.patch(f"/api/couriers/{cid}/status", json={"status": "in_transit"})
    events = client.get(f"/api/couriers/{cid}/events").json()
    assert [e["event"] for e in events] == ["created", "status:in_transit"]
    assert events[0]["from_status"] is None
    assert events[1]["from_status"] == "booked"
    assert events[0]["created_at"] <= events[1]["created_at"]


@pytest.mark.integration
def test_stats_and_revenue_math():
    _book(weight_kg=1)  # 6.99 + 4.50 = 11.49
    _book(weight_kg=2)  # 6.99 + 9.00 = 15.99
    stats = client.get("/api/stats").json()
    assert stats == {
        "total": 2,
        "booked": 2,
        "in_transit": 0,
        "out_for_delivery": 0,
        "delivered": 0,
        "cancelled": 0,
        "total_revenue_usd": 27.48,
    }
    rev = client.get("/api/revenue").json()
    assert rev["total_revenue_usd"] == 27.48 and rev["currency"] == "USD"


@pytest.mark.integration
def test_phone_searchable_and_pagination():
    _book(phone="+15550101010")
    _book(phone="+15550202020")
    assert len(client.get("/api/couriers", params={"q": "02020"}).json()) == 1
    page = client.get("/api/couriers", params={"limit": 1, "offset": 1}).json()
    assert len(page) == 1


@pytest.mark.integration
def test_seed_script_builds_demo_universe(tmp_path):
    """The seeder (sales-demo path) must produce the documented universe."""
    db_file = tmp_path / "seedcheck.db"
    env = dict(os.environ, DATABASE_URL=f"sqlite:///{db_file}")
    proc = subprocess.run(
        [sys.executable, "-m", "app.seed_demo", "--yes"],
        cwd=os.path.join(os.path.dirname(__file__), ".."),
        env=env,
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert proc.returncode == 0, proc.stderr
    assert "Seeded 19 shipments" in proc.stdout
