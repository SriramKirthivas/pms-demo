from conftest import auth, default_assignment, token

from app.eval import service as eval_service
from app.common import internal as internal_mod
from app.common.envelope import ApiError

ADMIN = ("admin", "Nina Patel")
MANAGER = ("manager", "Sarah Mitchell")
EMPLOYEE = ("employee", "David Chen")


def test_health(client):
    assert client.get("/api/health").json()["service"] == "pm-eval"


def test_append_only_self_and_reviewer(client):
    e, m = token(*EMPLOYEE), token(*MANAGER)
    aid = "asg-1"
    # employee self-rates twice (append-only history)
    client.post("/api/pm-eval/evaluations/self",
                json={"assignmentId": aid, "employeeId": "David Chen", "rating": 3.5}, headers=auth(e))
    client.post("/api/pm-eval/evaluations/self",
                json={"assignmentId": aid, "employeeId": "David Chen", "rating": 4.25}, headers=auth(e))
    # manager reviewer-rates
    client.post("/api/pm-eval/evaluations/reviewer",
                json={"assignmentId": aid, "employeeId": "David Chen", "rating": 4.0}, headers=auth(m))
    hist = client.get(f"/api/pm-eval/evaluations?assignmentId={aid}", headers=auth(m)).json()["data"]
    assert len(hist) == 3  # nothing overwritten
    cur = client.get(f"/api/pm-eval/evaluations/current?assignmentId={aid}", headers=auth(m)).json()["data"]
    assert cur["self"]["rating"] == 4.25 and cur["reviewer"]["rating"] == 4.0


def test_reviewer_requires_manager(client):
    e = token(*EMPLOYEE)
    r = client.post("/api/pm-eval/evaluations/reviewer",
                    json={"assignmentId": "a", "employeeId": "Someone", "rating": 4}, headers=auth(e))
    assert r.status_code == 403


def test_rating_range_validated(client):
    e = token(*EMPLOYEE)
    for bad in (0, 5.5):
        r = client.post("/api/pm-eval/evaluations/self",
                        json={"assignmentId": "a", "employeeId": "David Chen", "rating": bad}, headers=auth(e))
        assert r.status_code == 400 and r.json()["code"] == "PARAM_INVALID"


def test_continuous_feedback(client):
    m = token(*MANAGER)
    r = client.post("/api/pm-eval/feedback",
                    json={"aboutEmployeeId": "David Chen", "category": "STRETCH", "text": "Ready for more scope", "fiscalYear": "FY26-27"},
                    headers=auth(m))
    assert r.status_code == 200 and r.json()["data"]["category"] == "STRETCH"
    # bad category rejected
    assert client.post("/api/pm-eval/feedback",
                       json={"aboutEmployeeId": "David Chen", "category": "NOPE", "text": "x"},
                       headers=auth(m)).status_code == 400
    pg = client.get("/api/pm-eval/feedback?aboutEmployeeId=David Chen&category=STRETCH", headers=auth(m)).json()["data"]
    assert pg["total"] == 1 and len(pg["list"]) == 1
    assert pg["pageNum"] == 1 and pg["pageSize"] == 20


def test_finalize_marks_latest_and_finals_read(client):
    e, m = token(*EMPLOYEE), token(*MANAGER)
    client.post("/api/pm-eval/evaluations/self",
                json={"assignmentId": "A1", "employeeId": "David Chen", "rating": 4.0}, headers=auth(e))
    client.post("/api/pm-eval/evaluations/self",
                json={"assignmentId": "A1", "employeeId": "David Chen", "rating": 4.5}, headers=auth(e))
    client.post("/api/pm-eval/evaluations/reviewer",
                json={"assignmentId": "A1", "employeeId": "David Chen", "rating": 4.2}, headers=auth(m))
    r = client.post("/api/pm-eval/system/periods/P1/finalize", json={"assignmentIds": ["A1"]})
    assert r.status_code == 200 and r.json()["data"]["finalized"] == 2
    finals = client.get("/api/pm-eval/system/evaluations/final",
                        params={"employeeId": "David Chen"}).json()["data"]
    self_final = [f for f in finals if f["source"] == "SELF"][0]
    assert self_final["rating"] == 4.5  # latest self wins


# --------------------------------------------------------------------------
# Gap #1: rating precision
# --------------------------------------------------------------------------

def test_rating_precision_rejected(client):
    e = token(*EMPLOYEE)
    r = client.post("/api/pm-eval/evaluations/self",
                    json={"assignmentId": "asg-1", "employeeId": "David Chen", "rating": 4.256},
                    headers=auth(e))
    assert r.status_code == 400 and r.json()["code"] == "PARAM_INVALID"


def test_rating_precision_two_decimals_accepted(client):
    e = token(*EMPLOYEE)
    r = client.post("/api/pm-eval/evaluations/self",
                    json={"assignmentId": "asg-1", "employeeId": "David Chen", "rating": 4.25},
                    headers=auth(e))
    assert r.status_code == 200 and r.json()["data"]["rating"] == 4.25


# --------------------------------------------------------------------------
# Gap #2: pre-evaluation verification against pm-goal
# --------------------------------------------------------------------------

def test_evaluation_rejected_when_assignment_not_active(client, monkeypatch):
    def fake_verify(assignment_id):
        raise ApiError(409, "CONFLICT", "Assignment is not ACTIVE")
    monkeypatch.setattr(eval_service, "verify_assignment_active", fake_verify)
    e = token(*EMPLOYEE)
    r = client.post("/api/pm-eval/evaluations/self",
                    json={"assignmentId": "asg-locked", "employeeId": "David Chen", "rating": 4.0},
                    headers=auth(e))
    assert r.status_code == 409


def test_evaluation_rejected_when_period_locked(client, monkeypatch):
    def fake_fetch(assignment_id):
        return {**default_assignment(assignment_id), "periodLocked": True}
    monkeypatch.setattr(eval_service, "fetch_assignment", fake_fetch)
    e = token(*EMPLOYEE)
    r = client.post("/api/pm-eval/evaluations/self",
                    json={"assignmentId": "asg-1", "employeeId": "David Chen", "rating": 4.0},
                    headers=auth(e))
    assert r.status_code == 409


def test_evaluation_rejected_when_pm_goal_unreachable(client, monkeypatch):
    def fake_fetch(assignment_id):
        raise internal_mod.InternalCallError("timeout")
    monkeypatch.setattr(eval_service, "fetch_assignment", fake_fetch)
    e = token(*EMPLOYEE)
    r = client.post("/api/pm-eval/evaluations/self",
                    json={"assignmentId": "asg-1", "employeeId": "David Chen", "rating": 4.0},
                    headers=auth(e))
    assert r.status_code == 502


# --------------------------------------------------------------------------
# Gap #3: RATED event emitted to pm-goal for both sources
# --------------------------------------------------------------------------

def test_rated_event_emitted_for_both_sources(client, monkeypatch):
    calls = []

    def fake_emit(assignment_id, source, rated_by, evaluated_at):
        calls.append((assignment_id, source, rated_by))

    monkeypatch.setattr(eval_service, "_emit_rated_to_goal", fake_emit)
    e, m = token(*EMPLOYEE), token(*MANAGER)
    client.post("/api/pm-eval/evaluations/self",
                json={"assignmentId": "asg-1", "employeeId": "David Chen", "rating": 4.0}, headers=auth(e))
    client.post("/api/pm-eval/evaluations/reviewer",
                json={"assignmentId": "asg-1", "employeeId": "David Chen", "rating": 4.2}, headers=auth(m))
    sources = {c[1] for c in calls}
    assert sources == {"SELF", "REVIEWER"}


# --------------------------------------------------------------------------
# Gap #4/#5: finalize scoped by period + immutability
# --------------------------------------------------------------------------

def test_finalize_scoped_to_period(client, monkeypatch):
    """Two periods for the same assignment; finalizing P1 must not touch P2."""
    e = token(*EMPLOYEE)
    periods = {"asg-1": "P1"}

    def fake_verify(assignment_id):
        return {**default_assignment(assignment_id), "periodId": periods.get(assignment_id, "P1")}
    monkeypatch.setattr(eval_service, "verify_assignment_active", fake_verify)

    client.post("/api/pm-eval/evaluations/self",
                json={"assignmentId": "asg-1", "employeeId": "David Chen", "rating": 3.0, "periodId": "P1"},
                headers=auth(e))
    client.post("/api/pm-eval/evaluations/self",
                json={"assignmentId": "asg-1", "employeeId": "David Chen", "rating": 4.0, "periodId": "P2"},
                headers=auth(e))

    r = client.post("/api/pm-eval/system/periods/P1/finalize", json={"assignmentIds": ["asg-1"]})
    assert r.status_code == 200 and r.json()["data"]["finalized"] == 1

    hist = client.get("/api/pm-eval/evaluations?assignmentId=asg-1", headers=auth(e)).json()["data"]
    p1_eval = [h for h in hist if h["periodId"] == "P1"][0]
    p2_eval = [h for h in hist if h["periodId"] == "P2"][0]
    assert p1_eval["isFinal"] is True
    assert p2_eval["isFinal"] is False


def test_immutability_after_finalize(client, monkeypatch):
    e = token(*EMPLOYEE)

    def fake_verify(assignment_id):
        return {**default_assignment(assignment_id), "periodId": "P1"}
    monkeypatch.setattr(eval_service, "verify_assignment_active", fake_verify)

    client.post("/api/pm-eval/evaluations/self",
                json={"assignmentId": "asg-imm", "employeeId": "David Chen", "rating": 3.0, "periodId": "P1"},
                headers=auth(e))
    client.post("/api/pm-eval/system/periods/P1/finalize", json={"assignmentIds": ["asg-imm"]})

    r = client.post("/api/pm-eval/evaluations/self",
                    json={"assignmentId": "asg-imm", "employeeId": "David Chen", "rating": 3.5, "periodId": "P1"},
                    headers=auth(e))
    assert r.status_code == 409


# --------------------------------------------------------------------------
# Gap #6: period reopen
# --------------------------------------------------------------------------

def test_reopen_clears_is_final(client, monkeypatch):
    e = token(*EMPLOYEE)

    def fake_verify(assignment_id):
        return {**default_assignment(assignment_id), "periodId": "P1"}
    monkeypatch.setattr(eval_service, "verify_assignment_active", fake_verify)

    client.post("/api/pm-eval/evaluations/self",
                json={"assignmentId": "asg-reopen", "employeeId": "David Chen", "rating": 3.0, "periodId": "P1"},
                headers=auth(e))
    client.post("/api/pm-eval/system/periods/P1/finalize", json={"assignmentIds": ["asg-reopen"]})

    hist = client.get("/api/pm-eval/evaluations?assignmentId=asg-reopen", headers=auth(e)).json()["data"]
    assert hist[0]["isFinal"] is True

    r = client.post("/api/pm-eval/system/periods/P1/reopen")
    assert r.status_code == 200 and r.json()["data"]["reopened"] == 1

    hist = client.get("/api/pm-eval/evaluations?assignmentId=asg-reopen", headers=auth(e)).json()["data"]
    assert hist[0]["isFinal"] is False

    # after reopen, submitting again for the same period should succeed
    r = client.post("/api/pm-eval/evaluations/self",
                    json={"assignmentId": "asg-reopen", "employeeId": "David Chen", "rating": 3.8, "periodId": "P1"},
                    headers=auth(e))
    assert r.status_code == 200


# --------------------------------------------------------------------------
# Gap #8: quarterly check-in notes
# --------------------------------------------------------------------------

def test_checkin_notes_create_and_list(client):
    m = token(*MANAGER)
    r = client.post("/api/pm-eval/check-in-notes",
                    json={"employeeId": "David Chen", "periodId": "P1", "note": "On track", "fiscalYear": "FY26-27"},
                    headers=auth(m))
    assert r.status_code == 200 and r.json()["data"]["note"] == "On track"

    lst = client.get("/api/pm-eval/check-in-notes?employeeId=David Chen&periodId=P1", headers=auth(m)).json()["data"]
    assert len(lst) == 1 and lst[0]["authorId"] == "Sarah Mitchell"


def test_checkin_notes_reviewer_only(client):
    e = token(*EMPLOYEE)
    r = client.post("/api/pm-eval/check-in-notes",
                    json={"employeeId": "David Chen", "periodId": "P1", "note": "self note"},
                    headers=auth(e))
    assert r.status_code == 403


def test_system_checkin_notes_grouped_by_period(client):
    m = token(*MANAGER)
    client.post("/api/pm-eval/check-in-notes",
                json={"employeeId": "Alice Wong", "periodId": "P1", "note": "Q1 note", "fiscalYear": "FY26-27"},
                headers=auth(m))
    client.post("/api/pm-eval/check-in-notes",
                json={"employeeId": "Alice Wong", "periodId": "P2", "note": "Q2 note", "fiscalYear": "FY26-27"},
                headers=auth(m))
    r = client.get("/api/pm-eval/system/check-in-notes",
                   params={"employeeId": "Alice Wong", "fiscalYear": "FY26-27"})
    grouped = r.json()["data"]
    assert set(grouped.keys()) == {"P1", "P2"}


# --------------------------------------------------------------------------
# Gap #9: mid-year review checkpoint
# --------------------------------------------------------------------------

def test_mid_year_summary_does_not_finalize(client, monkeypatch):
    e, m = token(*EMPLOYEE), token(*MANAGER)

    def fake_verify(assignment_id):
        return {**default_assignment(assignment_id), "periodId": "Q1"}
    monkeypatch.setattr(eval_service, "verify_assignment_active", fake_verify)
    # No live pm-goal in tests: force H1 resolution to fall back to "all periods".
    monkeypatch.setattr(eval_service, "_h1_period_ids", lambda fiscal_year: [])

    client.post("/api/pm-eval/evaluations/self",
                json={"assignmentId": "asg-my", "employeeId": "David Chen", "rating": 4.0, "periodId": "Q1"},
                headers=auth(e))
    client.post("/api/pm-eval/check-in-notes",
                json={"employeeId": "David Chen", "periodId": "Q1", "note": "H1 check-in", "fiscalYear": "FY26-27"},
                headers=auth(m))

    r = client.get("/api/pm-eval/mid-year", params={"employeeId": "David Chen", "fiscalYear": "FY26-27"},
                   headers=auth(m))
    data = r.json()["data"]
    assert data["isFinal"] is False
    assert len(data["evaluations"]) == 1
    assert data["evaluations"][0]["self"]["rating"] == 4.0
    assert len(data["checkInNotes"]) == 1

    # confirm nothing was marked final as a side effect
    hist = client.get("/api/pm-eval/evaluations?assignmentId=asg-my", headers=auth(e)).json()["data"]
    assert all(not h["isFinal"] for h in hist)

    # further check-ins later in the year are still allowed
    r2 = client.post("/api/pm-eval/check-in-notes",
                     json={"employeeId": "David Chen", "periodId": "Q3", "note": "H2 check-in", "fiscalYear": "FY26-27"},
                     headers=auth(m))
    assert r2.status_code == 200


# --------------------------------------------------------------------------
# Gap #10: summary endpoint, system feedback endpoint
# --------------------------------------------------------------------------

def test_evaluations_summary(client, monkeypatch):
    e, m = token(*EMPLOYEE), token(*MANAGER)

    def fake_verify(assignment_id):
        return {**default_assignment(assignment_id), "periodId": "P1"}
    monkeypatch.setattr(eval_service, "verify_assignment_active", fake_verify)

    client.post("/api/pm-eval/evaluations/self",
                json={"assignmentId": "asg-sum", "employeeId": "David Chen", "rating": 3.5, "periodId": "P1"},
                headers=auth(e))
    client.post("/api/pm-eval/evaluations/reviewer",
                json={"assignmentId": "asg-sum", "employeeId": "David Chen", "rating": 4.0, "periodId": "P1"},
                headers=auth(m))

    r = client.get("/api/pm-eval/evaluations/summary", params={"employeeId": "David Chen", "periodId": "P1"},
                   headers=auth(m))
    data = r.json()["data"]
    assert len(data["assignments"]) == 1
    assert data["assignments"][0]["self"]["rating"] == 3.5
    assert data["assignments"][0]["reviewer"]["rating"] == 4.0


def test_system_feedback_grouped_by_category(client):
    m = token(*MANAGER)
    client.post("/api/pm-eval/feedback",
                json={"aboutEmployeeId": "David Chen", "category": "STRETCH", "text": "a", "fiscalYear": "FY26-27"},
                headers=auth(m))
    client.post("/api/pm-eval/feedback",
                json={"aboutEmployeeId": "David Chen", "category": "ATTITUDE", "text": "b", "fiscalYear": "FY26-27"},
                headers=auth(m))
    r = client.get("/api/pm-eval/system/feedback", params={"aboutEmployeeId": "David Chen", "fiscalYear": "FY26-27"})
    grouped = r.json()["data"]
    assert set(grouped.keys()) == {"STRETCH", "ATTITUDE"}


# --------------------------------------------------------------------------
# Gap #7: multi-tenant isolation
# --------------------------------------------------------------------------

def test_tenant_id_from_jwt_claim(client):
    import jwt as pyjwt
    t = pyjwt.encode(
        {"sub": "t@x.com", "name": "David Chen", "role": "employee", "country": "IE", "tenant_id": "acme"},
        "test-secret", algorithm="HS256",
    )
    r = client.post("/api/pm-eval/evaluations/self",
                    json={"assignmentId": "asg-tenant", "employeeId": "David Chen", "rating": 4.0},
                    headers=auth(t))
    assert r.status_code == 200
    from app.common import db as dbmod
    from app.eval.models import Evaluation
    session = dbmod._Session()
    try:
        row = session.query(Evaluation).filter_by(assignment_id="asg-tenant").first()
        assert row.tenant_id == "acme"
    finally:
        session.close()


def test_tenant_id_defaults_when_absent(client):
    e = token(*EMPLOYEE)  # no tenant_id claim
    r = client.post("/api/pm-eval/evaluations/self",
                    json={"assignmentId": "asg-default-tenant", "employeeId": "David Chen", "rating": 4.0},
                    headers=auth(e))
    assert r.status_code == 200
    from app.common import db as dbmod
    from app.eval.models import Evaluation
    session = dbmod._Session()
    try:
        row = session.query(Evaluation).filter_by(assignment_id="asg-default-tenant").first()
        assert row.tenant_id == "default"
    finally:
        session.close()


# --------------------------------------------------------------------------
# Tenant onboarding endpoints
# --------------------------------------------------------------------------

def test_tenant_onboarding_flow(client):
    r = client.post("/api/pm-eval/system/tenants/onboard", json={"tenantId": "acme"})
    assert r.status_code == 200 and r.json()["data"]["onboarded"] is True

    r2 = client.get("/api/pm-eval/system/tenants/acme")
    assert r2.status_code == 200 and r2.json()["data"]["onboarded"] is True

    r3 = client.get("/api/pm-eval/system/tenants/never-onboarded")
    assert r3.status_code == 200 and r3.json()["data"]["onboarded"] is False


# --------------------------------------------------------------------------
# Record-level access scoping (reviewer must be designated + read endpoints
# scoped to owner/reviewer/admin, or self/manager for employeeId-keyed data).
# Best-effort against pm-goal — these tests explicitly mock a reachable
# pm-goal returning real deny data; when pm-goal is unreachable (the default
# autouse fixture only patches fetch_assignment, not internal.get_json) the
# checks degrade open, which is what every other test above already exercises.
# --------------------------------------------------------------------------

def test_reviewer_must_be_a_designated_reviewer(client, monkeypatch):
    def fake_fetch(assignment_id):
        d = default_assignment(assignment_id)
        d["reviewerIds"] = ["Someone Else"]
        return d
    monkeypatch.setattr(eval_service, "fetch_assignment", fake_fetch)
    m = token(*MANAGER)  # Sarah Mitchell — not in reviewerIds
    r = client.post("/api/pm-eval/evaluations/reviewer",
                    json={"assignmentId": "asg-notmine", "employeeId": "David Chen", "rating": 4.0},
                    headers=auth(m))
    assert r.status_code == 403


def test_evaluation_history_scoped_to_owner_reviewer_admin(client, monkeypatch):
    monkeypatch.setattr(internal_mod, "get_json",
                        lambda service, path, params=None: default_assignment("asg-scope") if "assignments" in path else None)
    e, m, a = token(*EMPLOYEE), token(*MANAGER), token(*ADMIN)
    outsider = token("employee", "Priya Nair")
    client.post("/api/pm-eval/evaluations/self",
                json={"assignmentId": "asg-scope", "employeeId": "David Chen", "rating": 3.0}, headers=auth(e))

    assert client.get("/api/pm-eval/evaluations?assignmentId=asg-scope", headers=auth(e)).status_code == 200
    assert client.get("/api/pm-eval/evaluations?assignmentId=asg-scope", headers=auth(m)).status_code == 200
    assert client.get("/api/pm-eval/evaluations?assignmentId=asg-scope", headers=auth(a)).status_code == 200
    assert client.get("/api/pm-eval/evaluations?assignmentId=asg-scope", headers=auth(outsider)).status_code == 403
    assert client.get("/api/pm-eval/evaluations/current?assignmentId=asg-scope", headers=auth(outsider)).status_code == 403


def test_feedback_view_scoped_to_self_manager_admin(client, monkeypatch):
    monkeypatch.setattr(
        internal_mod, "get_json",
        lambda service, path, params=None: [{"id": "David Chen", "managerId": "Sarah Mitchell"}] if "employees" in path else None,
    )
    e, m, a = token(*EMPLOYEE), token(*MANAGER), token(*ADMIN)
    outsider = token("manager", "Elena Ruiz")
    client.post("/api/pm-eval/feedback",
                json={"aboutEmployeeId": "David Chen", "category": "STRETCH", "text": "Great work", "fiscalYear": "FY26-27"},
                headers=auth(m))

    assert client.get("/api/pm-eval/feedback?aboutEmployeeId=David Chen", headers=auth(e)).status_code == 200
    assert client.get("/api/pm-eval/feedback?aboutEmployeeId=David Chen", headers=auth(m)).status_code == 200
    assert client.get("/api/pm-eval/feedback?aboutEmployeeId=David Chen", headers=auth(a)).status_code == 200
    assert client.get("/api/pm-eval/feedback?aboutEmployeeId=David Chen", headers=auth(outsider)).status_code == 403


# --------------------------------------------------------------------------
# PMS v2: goal-scoped feedback, latest-evaluations export, comment round-trip
# --------------------------------------------------------------------------

def test_goal_scoped_vs_continuous_feedback(client):
    """Feedback carries an optional assignmentId; the scope/assignmentId filters
    keep goal-scoped feedback separate from general continuous feedback."""
    m = token(*MANAGER)
    # general (continuous) feedback — no assignmentId
    client.post("/api/pm-eval/feedback",
                json={"aboutEmployeeId": "David Chen", "category": "MOTIVATION",
                      "text": "Great attitude", "fiscalYear": "FY26-27"},
                headers=auth(m))
    # goal-scoped feedback — tied to a specific assignment
    r = client.post("/api/pm-eval/feedback",
                    json={"aboutEmployeeId": "David Chen", "category": "STRETCH",
                          "text": "Owned the rollout", "fiscalYear": "FY26-27",
                          "assignmentId": "asg-9"},
                    headers=auth(m))
    assert r.status_code == 200 and r.json()["data"]["assignmentId"] == "asg-9"
    # filter by assignmentId returns only the goal-scoped entry
    goal = client.get("/api/pm-eval/feedback?aboutEmployeeId=David Chen&assignmentId=asg-9",
                      headers=auth(m)).json()["data"]
    assert goal["total"] == 1 and goal["list"][0]["assignmentId"] == "asg-9"
    # scope=continuous excludes goal-scoped feedback
    cont = client.get("/api/pm-eval/feedback?aboutEmployeeId=David Chen&scope=continuous",
                      headers=auth(m)).json()["data"]
    assert cont["total"] == 1 and cont["list"][0]["assignmentId"] == ""


def test_latest_evaluations_by_assignment(client):
    """GET /system/evaluations/latest returns the latest self/reviewer rating +
    comment per assignment (powers the granular goal-sheet export)."""
    e, m = token(*EMPLOYEE), token(*MANAGER)
    client.post("/api/pm-eval/evaluations/self",
                json={"assignmentId": "asg-1", "employeeId": "David Chen", "rating": 3.0, "comment": "first"}, headers=auth(e))
    client.post("/api/pm-eval/evaluations/self",
                json={"assignmentId": "asg-1", "employeeId": "David Chen", "rating": 4.5, "comment": "improved"}, headers=auth(e))
    client.post("/api/pm-eval/evaluations/reviewer",
                json={"assignmentId": "asg-1", "employeeId": "David Chen", "rating": 4.0, "comment": "solid"}, headers=auth(m))
    latest = client.get("/api/pm-eval/system/evaluations/latest",
                        params={"employeeId": "David Chen"}).json()["data"]
    assert latest["asg-1"]["self"]["rating"] == 4.5      # latest self wins
    assert latest["asg-1"]["self"]["comment"] == "improved"
    assert latest["asg-1"]["reviewer"]["rating"] == 4.0
    assert latest["asg-1"]["reviewer"]["comment"] == "solid"


def test_evaluation_comment_round_trips(client):
    """A rating's free-text comment is stored and returned by /evaluations/current
    (the per-goal Employee's/Manager's view)."""
    m = token(*MANAGER)
    client.post("/api/pm-eval/evaluations/reviewer",
                json={"assignmentId": "asg-1", "employeeId": "David Chen", "rating": 4.0,
                      "comment": "Strong ownership on delivery"}, headers=auth(m))
    cur = client.get("/api/pm-eval/evaluations/current?assignmentId=asg-1", headers=auth(m)).json()["data"]
    assert cur["reviewer"]["rating"] == 4.0
    assert cur["reviewer"]["comment"] == "Strong ownership on delivery"
