from conftest import auth, token

MANAGER = ("manager", "Sarah Mitchell")
EMPLOYEE = ("employee", "David Chen")


def _emit(client, **kw):
    return client.post("/api/pm-notify/system/events", json=kw)


def test_health(client):
    assert client.get("/api/health").json()["service"] == "pm-notify"


def test_event_creates_notification_and_is_idempotent(client):
    _emit(client, eventId="e1", type="GOAL_CASCADED", recipientId="David Chen",
          title="Goal to accept", body="Roadmap Adherence", href="/goals")
    # same event id again -> no duplicate
    _emit(client, eventId="e1", type="GOAL_CASCADED", recipientId="David Chen", title="dup")
    data = client.get("/api/pm-notify/notifications", headers=auth(token(*EMPLOYEE))).json()["data"]
    lst = data["list"]
    assert data["total"] == 1
    assert len(lst) == 1 and lst[0]["type"] == "GOAL_CASCADED"


def test_recipient_scoping_and_read_state(client):
    _emit(client, eventId="e2", type="UNLOCK_REQUESTED", recipientId="David Chen", title="A")
    _emit(client, eventId="e3", type="RATING_SUBMITTED", recipientId="David Chen", title="B")
    e = token(*EMPLOYEE)
    # employee sees their 2; unread count 2
    assert client.get("/api/pm-notify/notifications/unread-count", headers=auth(e)).json()["data"]["unread"] == 2
    # a different user sees none
    assert client.get("/api/pm-notify/notifications", headers=auth(token(*MANAGER))).json()["data"]["list"] == []
    # mark one read
    nid = client.get("/api/pm-notify/notifications", headers=auth(e)).json()["data"]["list"][0]["id"]
    client.post(f"/api/pm-notify/notifications/{nid}/read", headers=auth(e))
    assert client.get("/api/pm-notify/notifications/unread-count", headers=auth(e)).json()["data"]["unread"] == 1
    # mark all read
    client.post("/api/pm-notify/notifications/read-all", headers=auth(e))
    assert client.get("/api/pm-notify/notifications/unread-count", headers=auth(e)).json()["data"]["unread"] == 0


def test_unknown_event_type_rejected(client):
    r = _emit(client, eventId="e4", type="NONSENSE", recipientId="X", title="t")
    assert r.status_code == 400
