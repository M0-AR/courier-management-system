"""End-to-end API contract tests — every original feature + hardening.

Run:  pip install -r requirements-dev.txt && pytest -q
Uses an isolated SQLite file (never touches Postgres).
"""
import os
import sys

os.environ["DATABASE_URL"] = "sqlite:///./test_contract.db"
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi.testclient import TestClient

from app.database import Base, engine
from app.main import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def fresh_db():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    yield


def _book(**over):
    payload = {
        "customer_name": "Rahul",
        "phone": "+15550102030",
        "parcel_type": "Documents",
        "weight_kg": 2,
        "source": "Austin",
        "destination": "Denver",
    }
    payload.update(over)
    return client.post("/api/couriers", json=payload)


def test_health_reports_database():
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json()["database"] == "up"
    assert "X-Request-ID" in r.headers
    assert r.headers["X-Content-Type-Options"] == "nosniff"


def test_ready():
    assert client.get("/api/ready").status_code == 200


def test_create_prices_in_usd():
    r = _book()
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["charge_usd"] == round(6.99 + 4.50 * 2, 2)
    assert body["tracking_id"].startswith("SWC-")
    assert body["eta_date"] and "stimated" in body["eta_label"]


def test_create_event_logged():
    cid = _book().json()["id"]
    events = client.get(f"/api/couriers/{cid}/events").json()
    assert len(events) == 1 and events[0]["event"] == "created"


def test_illegal_transition_rejected_and_legal_advance_logged():
    cid = _book().json()["id"]
    assert client.patch(f"/api/couriers/{cid}/status", json={"status": "delivered"}).status_code == 409
    r = client.patch(f"/api/couriers/{cid}/status", json={"status": "in_transit"})
    assert r.status_code == 200 and r.json()["status"] == "in_transit"
    events = client.get(f"/api/couriers/{cid}/events").json()
    assert [e["event"] for e in events] == ["created", "status:in_transit"]


def test_delivered_eta_uses_actual_date():
    cid = _book().json()["id"]
    for s in ("in_transit", "out_for_delivery", "delivered"):
        client.patch(f"/api/couriers/{cid}/status", json={"status": s})
    body = client.get(f"/api/couriers/{cid}").json()
    assert body["eta_label"].startswith("Delivered")


def test_validation_rejects_bad_payload():
    r = client.post(
        "/api/couriers",
        json={"customer_name": "X", "phone": "1", "parcel_type": "D", "weight_kg": -5, "source": "A", "destination": "B"},
    )
    assert r.status_code == 422


def test_by_tracking_lookup():
    code = _book().json()["tracking_id"]
    assert client.get(f"/api/couriers/by-tracking/{code.lower()}").status_code == 200
    assert client.get("/api/couriers/by-tracking/SWC-NOPE").status_code == 404


def test_search_filter_and_revenue():
    _book(customer_name="Rahul")
    _book(customer_name="Mohit Sharma", weight_kg=4)
    assert len(client.get("/api/couriers", params={"q": "rahul"}).json()) == 1
    rev = client.get("/api/revenue").json()
    assert rev["total_revenue_usd"] == round((6.99 + 9.0) + (6.99 + 18.0), 2)
    assert rev["total_count"] == 2


def test_delete_removes_courier_and_events():
    cid = _book().json()["id"]
    assert client.delete(f"/api/couriers/{cid}").status_code == 204
    assert client.get(f"/api/couriers/{cid}").status_code == 404
    assert client.get(f"/api/couriers/{cid}/events").status_code == 404
