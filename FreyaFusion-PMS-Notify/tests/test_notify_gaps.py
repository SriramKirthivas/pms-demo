"""Tests for the newly implemented gaps: SQS processing, dedupe table,
email delivery + preferences, pagination, and tenant onboarding.
"""
from unittest.mock import patch

from conftest import auth, token

from app.common.db import get_session
from app.notify import schemas
from app.notify.models import EventDedupe
from app.notify.sqs_consumer import process_message

MANAGER = ("manager", "Sarah Mitchell")
EMPLOYEE = ("employee", "David Chen")


def _emit(client, **kw):
    return client.post("/api/pm-notify/system/events", json=kw)


# --- SQS message processing (no real AWS) --------------------------------

def test_process_message_creates_notification(client):
    process_message({
        "eventId": "sqs-1", "type": "GOAL_CASCADED",
        "recipientId": "David Chen", "title": "Goal to accept", "body": "b",
    })
    data = client.get("/api/pm-notify/notifications", headers=auth(token(*EMPLOYEE))).json()["data"]
    assert data["total"] == 1
    assert data["list"][0]["type"] == "GOAL_CASCADED"


def test_process_message_rejects_unknown_type(client):
    try:
        process_message({
            "eventId": "sqs-2", "type": "NOT_A_TYPE",
            "recipientId": "David Chen", "title": "x",
        })
        raised = False
    except Exception:
        raised = True
    assert raised


# --- Dedupe table idempotency ---------------------------------------------

def test_dedupe_table_used_for_idempotency(client):
    _emit(client, eventId="dedupe-1", type="GOAL_CASCADED", recipientId="David Chen", title="A")
    _emit(client, eventId="dedupe-1", type="GOAL_CASCADED", recipientId="David Chen", title="A-dup")

    db_gen = get_session()
    db = next(db_gen)
    try:
        rows = db.query(EventDedupe).filter_by(event_id="dedupe-1").all()
        assert len(rows) == 1
    finally:
        db_gen.close()

    data = client.get("/api/pm-notify/notifications", headers=auth(token(*EMPLOYEE))).json()["data"]
    assert data["total"] == 1


def test_redelivered_event_via_sqs_path_is_also_deduped(client):
    process_message({
        "eventId": "dedupe-2", "type": "GOAL_CASCADED",
        "recipientId": "David Chen", "title": "first",
    })
    # redeliver same event id, this time via HTTP fallback -> still deduped
    _emit(client, eventId="dedupe-2", type="GOAL_CASCADED", recipientId="David Chen", title="second")
    data = client.get("/api/pm-notify/notifications", headers=auth(token(*EMPLOYEE))).json()["data"]
    assert data["total"] == 1
    assert data["list"][0]["title"] == "first"


# --- Email delivery ---------------------------------------------------------

def test_email_eligible_event_triggers_send_email(client):
    with patch("app.notify.service.send_email") as mock_send:
        _emit(client, eventId="email-1", type="SCORECARD_PUBLISHED",
              recipientId="David Chen", title="Scorecard published", body="body")
        assert mock_send.called
        args, _ = mock_send.call_args
        assert args[0] == "David Chen"


def test_non_eligible_event_does_not_trigger_email(client):
    with patch("app.notify.service.send_email") as mock_send:
        _emit(client, eventId="email-2", type="GOAL_CASCADED",
              recipientId="David Chen", title="Goal cascaded")
        assert not mock_send.called


def test_disabled_preference_suppresses_email_but_keeps_notification(client):
    e = token(*EMPLOYEE)
    r = client.put(
        "/api/pm-notify/preferences",
        headers=auth(e),
        json={"preferences": [{"eventType": "SCORECARD_PUBLISHED", "emailEnabled": False}]},
    )
    assert r.status_code == 200

    with patch("app.notify.service.send_email") as mock_send:
        _emit(client, eventId="email-3", type="SCORECARD_PUBLISHED",
              recipientId="David Chen", title="Scorecard published")
        assert not mock_send.called

    data = client.get("/api/pm-notify/notifications", headers=auth(e)).json()["data"]
    assert any(n["type"] == "SCORECARD_PUBLISHED" for n in data["list"])


def test_get_preferences_defaults_true_for_all_event_types(client):
    e = token(*EMPLOYEE)
    prefs = client.get("/api/pm-notify/preferences", headers=auth(e)).json()["data"]
    assert set(prefs.keys()) == schemas.EVENT_TYPES
    assert all(v is True for v in prefs.values())


# --- Pagination -------------------------------------------------------------

def test_pagination_returns_correct_page_slices(client):
    e = token(*EMPLOYEE)
    for i in range(5):
        _emit(client, eventId=f"page-{i}", type="GOAL_CASCADED",
              recipientId="David Chen", title=f"n{i}")

    page1 = client.get(
        "/api/pm-notify/notifications?pageNum=1&pageSize=2", headers=auth(e)
    ).json()["data"]
    page2 = client.get(
        "/api/pm-notify/notifications?pageNum=2&pageSize=2", headers=auth(e)
    ).json()["data"]
    page3 = client.get(
        "/api/pm-notify/notifications?pageNum=3&pageSize=2", headers=auth(e)
    ).json()["data"]

    assert page1["total"] == 5
    assert len(page1["list"]) == 2
    assert len(page2["list"]) == 2
    assert len(page3["list"]) == 1
    ids = {n["id"] for n in page1["list"]} | {n["id"] for n in page2["list"]} | {n["id"] for n in page3["list"]}
    assert len(ids) == 5  # no overlap/duplicates across pages


# --- Tenant onboarding -------------------------------------------------------

def test_tenant_onboarding_endpoints(client):
    r1 = client.post("/api/pm-notify/tenant/onboarding", json={"tenant_id": 1})
    assert r1.status_code == 200
    assert r1.json()["data"]["status"] == "COMPLETED"

    r2 = client.post("/api/pm-notify/tenant/onboarding/query", json={"tenant_id": 1})
    assert r2.status_code == 200
    assert r2.json()["data"]["status"] == "COMPLETED"
