from conftest import auth, token

from app.score import ipf as ipf_module
from app.score import service

ADMIN = ("admin", "Nina Patel")
MANAGER = ("manager", "Sarah Mitchell")
EMPLOYEE = ("employee", "David Chen")

FY = "FY26-27"


def _goal(weight, self_rating, manager_rating):
    return {"weight": weight, "selfRating": self_rating, "managerRating": manager_rating}


def _full_quarter(team_ratings, indiv_ratings):
    """team_ratings/indiv_ratings: (self, manager) tuples for 2 goals of weight 5 each."""
    return {
        "team": [_goal(5, team_ratings[0], team_ratings[1]), _goal(5, team_ratings[0], team_ratings[1])],
        "individual": [_goal(5, indiv_ratings[0], indiv_ratings[1]), _goal(5, indiv_ratings[0], indiv_ratings[1])],
    }


# Hand-computed worked example (see report / task for the derivation):
#   Q1: team=3.5, indiv=5.0 -> 0.35+0.25=0.60
#   Q2: team=5.0, indiv=4.0 -> 0.50+0.20=0.70
#   Q3: team=3.0, indiv=3.0 -> 0.30+0.15=0.45
#   Q4: team=4.0, indiv=4.0 -> 0.40+0.20=0.60
#   team-goals contribution = 2.35
#   annual: sectionA=(5x5+5x3)/10=4.0 -> 0.8; sectionB=4.0 -> 0.8 => 1.6
#   Final IPF = 2.35 + 1.6 = 3.95
FULL_QUARTERS = {
    "Q1": {
        "team": [_goal(5, 4, 4), _goal(5, 3, 3)],
        "individual": [_goal(5, 5, 5), _goal(5, 5, 5)],
    },
    "Q2": {
        "team": [_goal(5, 5, 5), _goal(5, 5, 5)],
        "individual": [_goal(5, 4, 4), _goal(5, 4, 4)],
    },
    "Q3": {
        "team": [_goal(5, 3, 3), _goal(5, 3, 3)],
        "individual": [_goal(5, 3, 3), _goal(5, 3, 3)],
    },
    "Q4": {
        "team": [_goal(5, 4, 4), _goal(5, 4, 4)],
        "individual": [_goal(5, 4, 4), _goal(5, 4, 4)],
    },
}
FULL_ANNUAL = {
    "sectionA": [_goal(5, 5, 5), _goal(5, 3, 3)],
    "sectionB": [_goal(5, 4, 4), _goal(5, 4, 4)],
}
EXPECTED_FINAL_IPF = 3.95


def _assignments_for(quarters: dict, annual: dict) -> list[dict]:
    """Flatten the quarters/annual test fixtures into the shape pm-goal's
    /system/assignments returns: [{assignmentId, pillar, weight, cadence, status}]."""
    out = []
    n = 0
    for q, pillars in quarters.items():
        for pillar_key, bucket in (("team", "TEAM_GOAL"), ("individual", "INDIVIDUAL_CONTRIBUTION")):
            for g in pillars[pillar_key]:
                n += 1
                out.append({
                    "assignmentId": f"a{n}", "pillar": bucket, "weight": g["weight"],
                    "cadence": "QUARTERLY", "status": "LOCKED", "periodCode": q,
                })
    for pillar_key, bucket in (("sectionA", "TRAININGS_AND_CERTS"), ("sectionB", "INDIVIDUAL_CONTRIBUTION")):
        for g in annual[pillar_key]:
            n += 1
            out.append({
                "assignmentId": f"a{n}", "pillar": bucket, "weight": g["weight"],
                "cadence": "ANNUAL", "status": "LOCKED",
            })
    return out


def _finals_for(assignments: list[dict], quarters: dict, annual: dict) -> list[dict]:
    """Build the pm-eval /system/evaluations/final shape: [{assignmentId, source, rating}]."""
    # Rebuild the same goal list in the same order used by _assignments_for so
    # ratings line up with the assignmentIds assigned there.
    goals = []
    for q, pillars in quarters.items():
        for pillar_key in ("team", "individual"):
            goals.extend(pillars[pillar_key])
    for pillar_key in ("sectionA", "sectionB"):
        goals.extend(annual[pillar_key])

    out = []
    for a, g in zip(assignments, goals):
        out.append({"assignmentId": a["assignmentId"], "source": "SELF", "rating": g["selfRating"]})
        out.append({"assignmentId": a["assignmentId"], "source": "REVIEWER", "rating": g["managerRating"]})
    return out


def _patch_pmgoal_pmeval(monkeypatch, quarters=FULL_QUARTERS, annual=FULL_ANNUAL, framework=None):
    assignments = _assignments_for(quarters, annual)
    finals = _finals_for(assignments, quarters, annual)
    monkeypatch.setattr(service, "_fetch_assignments", lambda emp, fy: assignments)
    monkeypatch.setattr(service, "_fetch_finals", lambda emp, fy: finals)
    monkeypatch.setattr(service, "_fetch_framework", lambda fy: framework or {})
    return assignments, finals


def test_health(client):
    assert client.get("/api/health").json()["service"] == "pm-score"


def test_bands_listed(client):
    r = client.get("/api/pm-score/bands", headers=auth(token(*EMPLOYEE)))
    assert r.status_code == 200
    assert any(b["band"] == "Exceeds Expectations" for b in r.json()["data"])


def test_section_score_normalization_matches_spec_example():
    # Spec worked example: weights [5, 5], manager ratings [4, 3] -> 3.5
    goals = [_goal(5, None, 4), _goal(5, None, 3)]
    assert ipf_module.section_score(goals, "manager") == 3.5


def test_section_score_rejects_weights_not_summing_to_10():
    goals = [_goal(6, 4, 4), _goal(6, 4, 4)]  # totals 12, not 10
    try:
        ipf_module.section_score(goals, "manager")
        assert False, "expected IPFError"
    except ipf_module.IPFError as e:
        assert "must total 10" in str(e)


def test_full_quarterly_annual_rollup_matches_hand_computed_value():
    result = ipf_module.compute_final(FULL_QUARTERS, FULL_ANNUAL)
    assert result["managerFinalIPF"] == EXPECTED_FINAL_IPF
    assert result["selfFinalIPF"] == EXPECTED_FINAL_IPF
    assert result["bandManager"] == "Exceeds Expectations"


def test_compute_ipf_via_api_pulls_from_pmgoal_pmeval(client, monkeypatch):
    _patch_pmgoal_pmeval(monkeypatch)
    r = client.post("/api/pm-score/scorecards/compute",
                    json={"employeeId": "David Chen", "fiscalYear": FY},
                    headers=auth(token(*ADMIN)))
    assert r.status_code == 200
    d = r.json()["data"]
    assert d["managerFinalIPF"] == EXPECTED_FINAL_IPF
    assert d["selfFinalIPF"] == EXPECTED_FINAL_IPF
    assert d["bandManager"] == "Exceeds Expectations"
    assert d["nineBox"]["performanceLevel"] == 3  # >= 3.8


def test_compute_requires_manager(client, monkeypatch):
    _patch_pmgoal_pmeval(monkeypatch)
    r = client.post("/api/pm-score/scorecards/compute",
                    json={"employeeId": "David Chen", "fiscalYear": FY},
                    headers=auth(token(*EMPLOYEE)))
    assert r.status_code == 403


def test_ninebox_place(client, monkeypatch):
    _patch_pmgoal_pmeval(monkeypatch)
    client.post("/api/pm-score/scorecards/compute",
                json={"employeeId": "David Chen", "fiscalYear": FY},
                headers=auth(token(*ADMIN)))
    r = client.post("/api/pm-score/nine-box/place",
                    json={"employeeId": "David Chen", "fiscalYear": FY, "potentialLevel": 3},
                    headers=auth(token(*MANAGER)))
    d = r.json()["data"]
    assert d["performanceLevel"] == 3 and d["potentialLevel"] == 3 and d["boxLabel"] == "Star"


def test_nine_box_matrix_department_filter(client, monkeypatch):
    _patch_pmgoal_pmeval(monkeypatch)
    client.post("/api/pm-score/scorecards/compute",
                json={"employeeId": "David Chen", "fiscalYear": FY},
                headers=auth(token(*ADMIN)))
    client.post("/api/pm-score/nine-box/place",
                json={"employeeId": "David Chen", "fiscalYear": FY, "potentialLevel": 3, "department": "Engineering"},
                headers=auth(token(*MANAGER)))
    # Matching department -> included
    r = client.get("/api/pm-score/nine-box", params={"fiscalYear": FY, "department": "Engineering"},
                    headers=auth(token(*MANAGER)))
    assert len(r.json()["data"]) == 1
    # Non-matching department -> excluded
    r2 = client.get("/api/pm-score/nine-box", params={"fiscalYear": FY, "department": "Sales"},
                     headers=auth(token(*MANAGER)))
    assert len(r2.json()["data"]) == 0


def test_acknowledge_then_signoff(client, monkeypatch):
    _patch_pmgoal_pmeval(monkeypatch)
    sc = client.post("/api/pm-score/scorecards/compute",
                     json={"employeeId": "David Chen", "fiscalYear": FY},
                     headers=auth(token(*ADMIN))).json()["data"]
    sid = sc["id"]
    # sign-off before acknowledge -> 409
    assert client.post(f"/api/pm-score/scorecards/{sid}/signoff", headers=auth(token(*ADMIN))).status_code == 409
    # only the employee can acknowledge
    assert client.post(f"/api/pm-score/scorecards/{sid}/acknowledge", headers=auth(token(*MANAGER))).status_code == 403
    ack = client.post(f"/api/pm-score/scorecards/{sid}/acknowledge", headers=auth(token(*EMPLOYEE))).json()["data"]
    assert ack["state"] == "ACKNOWLEDGED"
    assert ack["acknowledgedAt"] is not None
    # HRBP (admin) signs off
    so = client.post(f"/api/pm-score/scorecards/{sid}/signoff", headers=auth(token(*ADMIN))).json()["data"]
    assert so["state"] == "SIGNED_OFF"
    assert so["signedOffAt"] is not None
    # signed-off scorecard cannot be recomputed
    assert client.post("/api/pm-score/scorecards/compute",
                       json={"employeeId": "David Chen", "fiscalYear": FY},
                       headers=auth(token(*ADMIN))).status_code == 409


def test_compute_without_sections_or_siblings_is_400(client, monkeypatch):
    monkeypatch.setattr(service, "_fetch_assignments", lambda emp, fy: [])
    monkeypatch.setattr(service, "_fetch_finals", lambda emp, fy: [])
    monkeypatch.setattr(service, "_fetch_framework", lambda fy: {})
    m = token(*MANAGER)
    r = client.post("/api/pm-score/scorecards/compute",
                    json={"employeeId": "David Chen", "fiscalYear": "FYX"}, headers=auth(m))
    assert r.status_code == 400 and r.json()["code"] == "PARAM_INVALID"


def test_incomplete_scorecard_when_period_not_finalized(client, monkeypatch):
    # Q4 has no manager rating yet -> incomplete, no Final IPF published.
    quarters = {
        "Q1": FULL_QUARTERS["Q1"], "Q2": FULL_QUARTERS["Q2"], "Q3": FULL_QUARTERS["Q3"],
        "Q4": {
            "team": [_goal(5, 4, None), _goal(5, 4, None)],
            "individual": [_goal(5, 4, None), _goal(5, 4, None)],
        },
    }
    assignments = _assignments_for(quarters, FULL_ANNUAL)
    finals = [f for f in _finals_for(assignments, quarters, FULL_ANNUAL) if f["rating"] is not None]
    monkeypatch.setattr(service, "_fetch_assignments", lambda emp, fy: assignments)
    monkeypatch.setattr(service, "_fetch_finals", lambda emp, fy: finals)
    monkeypatch.setattr(service, "_fetch_framework", lambda fy: {})

    r = client.post("/api/pm-score/scorecards/compute",
                    json={"employeeId": "David Chen", "fiscalYear": FY},
                    headers=auth(token(*ADMIN)))
    assert r.status_code == 200
    d = r.json()["data"]
    assert d["state"] == "INCOMPLETE"
    assert d["incompleteReason"]
    assert d["managerFinalIPF"] == 0.0  # not published


def test_scorecard_breakdown_endpoint(client, monkeypatch):
    _patch_pmgoal_pmeval(monkeypatch)
    client.post("/api/pm-score/scorecards/compute",
                json={"employeeId": "David Chen", "fiscalYear": FY},
                headers=auth(token(*ADMIN)))
    r = client.get("/api/pm-score/scorecards/breakdown",
                   params={"employeeId": "David Chen", "fiscalYear": FY},
                   headers=auth(token(*ADMIN)))
    assert r.status_code == 200
    rows = r.json()["data"]
    assert len(rows) == 10  # 4 quarters x 2 pillars + 2 annual sections
    q1_team = next(row for row in rows if row["period"] == "Q1" and row["pillar"] == "TEAM_GOAL")
    assert q1_team["managerScore"] == 3.5


def test_pro_rated_ipf_for_partial_year_joiner(client, monkeypatch):
    # Joiner: only participated in Q3 and Q4.
    partial_quarters = {"Q3": FULL_QUARTERS["Q3"], "Q4": FULL_QUARTERS["Q4"]}
    assignments = _assignments_for(partial_quarters, FULL_ANNUAL)
    finals = _finals_for(assignments, partial_quarters, FULL_ANNUAL)
    monkeypatch.setattr(service, "_fetch_assignments", lambda emp, fy: assignments)
    monkeypatch.setattr(service, "_fetch_finals", lambda emp, fy: finals)
    monkeypatch.setattr(service, "_fetch_framework", lambda fy: {})

    r = client.post("/api/pm-score/scorecards/compute",
                    json={
                        "employeeId": "New Joiner", "fiscalYear": FY,
                        "partialYear": True, "participatedPeriods": ["Q3", "Q4"],
                    },
                    headers=auth(token(*ADMIN)))
    assert r.status_code == 200
    d = r.json()["data"]
    assert d["partialYear"] is True
    assert d["participatedPeriods"] == ["Q3", "Q4"]
    # hand-computed: team contribution normalized to 2 quarters (weights doubled),
    # annual unchanged -> Final IPF = 3.70 (see report for derivation)
    assert d["managerFinalIPF"] == 3.70


def test_band_boundary_resolves_to_higher_band_from_seeded_table(client, monkeypatch):
    from app.common import db as dbmod
    # Seed the tenant bands table (idempotent onboarding) then confirm
    # band_for reads from it, including boundary resolution to the higher band.
    r = client.post("/api/pm-score/tenant/onboarding", json={"tenantId": "default"})
    assert r.status_code == 200
    assert r.json()["data"]["status"] == "COMPLETED"

    session = dbmod._Session()
    try:
        from app.score import service as svc
        bands = svc._bands_from_db(session)
        assert bands  # seeded
        label, action = ipf_module.band_for(3.8, bands)
        assert label == "Exceeds Expectations"
        assert action == "Fast-track + Mentorship role"
        label2, _ = ipf_module.band_for(4.2, bands)
        assert label2 == "Exceeds Expectations"
    finally:
        session.close()

    # Re-run onboarding: idempotent, does not duplicate seed rows.
    client.post("/api/pm-score/tenant/onboarding", json={"tenantId": "default"})
    r2 = client.get("/api/pm-score/bands", headers=auth(token(*EMPLOYEE)))
    assert len(r2.json()["data"]) == 5


def test_tenant_onboarding_query(client):
    r = client.post("/api/pm-score/tenant/onboarding/query", json={"tenantId": "default"})
    assert r.status_code == 200
    assert r.json()["data"]["status"] == "COMPLETED"


def test_calibration_adjust_and_reject_after_signoff(client, monkeypatch):
    _patch_pmgoal_pmeval(monkeypatch)
    sc = client.post("/api/pm-score/scorecards/compute",
                     json={"employeeId": "David Chen", "fiscalYear": FY},
                     headers=auth(token(*ADMIN))).json()["data"]
    sid = sc["id"]

    # Only HR/Admin may calibrate.
    r_forbidden = client.post("/api/pm-score/calibration/adjust",
                              json={"employeeId": "David Chen", "fiscalYear": FY,
                                    "adjustedManagerFinalIPF": 4.6, "reason": "Cohort moderation"},
                              headers=auth(token(*MANAGER)))
    assert r_forbidden.status_code == 403

    r = client.post("/api/pm-score/calibration/adjust",
                    json={"employeeId": "David Chen", "fiscalYear": FY,
                          "adjustedManagerFinalIPF": 4.6, "reason": "Cohort moderation"},
                    headers=auth(token(*ADMIN)))
    assert r.status_code == 200
    d = r.json()["data"]
    assert d["managerFinalIPF"] == 4.6
    assert d["bandManager"] == "Exceptional"  # re-resolved from new value

    # Calibration view shows the adjusted value.
    view = client.get("/api/pm-score/calibration", params={"fiscalYear": FY},
                      headers=auth(token(*ADMIN))).json()["data"]
    assert any(row["employeeId"] == "David Chen" and row["managerFinalIPF"] == 4.6 for row in view)

    # Sign off, then calibration must be rejected with 409.
    client.post(f"/api/pm-score/scorecards/{sid}/acknowledge", headers=auth(token(*EMPLOYEE)))
    client.post(f"/api/pm-score/scorecards/{sid}/signoff", headers=auth(token(*ADMIN)))
    r_after = client.post("/api/pm-score/calibration/adjust",
                          json={"employeeId": "David Chen", "fiscalYear": FY,
                                "adjustedManagerFinalIPF": 5.0, "reason": "too late"},
                          headers=auth(token(*ADMIN)))
    assert r_after.status_code == 409


def test_dev_plan_build_prepopulates_from_feedback(client, monkeypatch):
    feedback = {
        "STRETCH": [{"text": "Led the migration project independently"}],
        "IMPROVEMENT": [{"text": "Needs to delegate more"}],
        "GENERAL": [{"text": "Ignored — wrong category"}],
    }
    monkeypatch.setattr(service, "_fetch_feedback", lambda emp, fy: feedback)

    r = client.post("/api/pm-score/dev-plans/build",
                    json={"employeeId": "David Chen", "fiscalYear": FY, "reviewStage": "EOY"},
                    headers=auth(token(*MANAGER)))
    assert r.status_code == 200
    d = r.json()["data"]
    assert "Led the migration project independently" in d["keyStrengths"]
    assert "Needs to delegate more" in d["improvementAreas"]
    assert "wrong category" not in d["keyStrengths"]
    assert d["nextFYPlan"] == ""  # left for the manager to fill in

    plan_id = d["id"]
    edited = client.put(f"/api/pm-score/dev-plans/{plan_id}",
                        json={"nextFYPlan": "Move into a tech-lead role", "recommendedTrainings": "AWS cert"},
                        headers=auth(token(*MANAGER))).json()["data"]
    assert edited["nextFYPlan"] == "Move into a tech-lead role"
    assert edited["recommendedTrainings"] == "AWS cert"
    # Original pre-populated fields are preserved.
    assert "Led the migration" in edited["keyStrengths"]

    listed = client.get("/api/pm-score/dev-plans", params={"employeeId": "David Chen", "fiscalYear": FY},
                        headers=auth(token(*MANAGER))).json()["data"]
    assert len(listed) == 1
    assert listed[0]["reviewStage"] == "EOY"


def test_dev_plan_build_requires_manager(client, monkeypatch):
    monkeypatch.setattr(service, "_fetch_feedback", lambda emp, fy: {})
    r = client.post("/api/pm-score/dev-plans/build",
                    json={"employeeId": "David Chen", "fiscalYear": FY, "reviewStage": "MID_YEAR"},
                    headers=auth(token(*EMPLOYEE)))
    assert r.status_code == 403


def test_system_scorecard_internal_endpoint(client, monkeypatch):
    _patch_pmgoal_pmeval(monkeypatch)
    client.post("/api/pm-score/scorecards/compute",
                json={"employeeId": "David Chen", "fiscalYear": FY},
                headers=auth(token(*ADMIN)))
    r = client.get("/api/pm-score/system/scorecards/David Chen", params={"fiscalYear": FY})
    assert r.status_code == 200
    assert r.json()["data"]["managerFinalIPF"] == EXPECTED_FINAL_IPF


def test_employee_cannot_view_other_employee_scorecard(client, monkeypatch):
    _patch_pmgoal_pmeval(monkeypatch)
    client.post("/api/pm-score/scorecards/compute",
                json={"employeeId": "David Chen", "fiscalYear": FY},
                headers=auth(token(*ADMIN)))
    other_employee_token = token("employee", "Someone Else")
    r = client.get("/api/pm-score/scorecards", params={"employeeId": "David Chen", "fiscalYear": FY},
                   headers=auth(other_employee_token))
    assert r.status_code == 403


# --------------------------------------------------------------------------
# Record-level access scoping — previously ANY manager could view ANY
# employee's scorecard/breakdown, and GET /dev-plans had no check at all.
# --------------------------------------------------------------------------

def test_unrelated_manager_cannot_view_scorecard_when_pmgoal_says_no(client, monkeypatch):
    _patch_pmgoal_pmeval(monkeypatch)
    client.post("/api/pm-score/scorecards/compute",
                json={"employeeId": "David Chen", "fiscalYear": FY},
                headers=auth(token(*ADMIN)))
    monkeypatch.setattr(
        service.internal, "get_json",
        lambda svc, path, params=None: [{"id": "David Chen", "managerId": "Sarah Mitchell"}] if "employees" in path else None,
    )
    unrelated_manager = token("manager", "Elena Ruiz")
    r = client.get("/api/pm-score/scorecards", params={"employeeId": "David Chen", "fiscalYear": FY},
                   headers=auth(unrelated_manager))
    assert r.status_code == 403
    # David Chen's real manager still can.
    r2 = client.get("/api/pm-score/scorecards", params={"employeeId": "David Chen", "fiscalYear": FY},
                    headers=auth(token(*MANAGER)))
    assert r2.status_code == 200


def test_dev_plans_view_scoped_to_self_manager_admin(client, monkeypatch):
    monkeypatch.setattr(service, "_fetch_feedback", lambda emp, fy: {})
    client.post("/api/pm-score/dev-plans/build",
                json={"employeeId": "David Chen", "fiscalYear": FY, "reviewStage": "MID_YEAR"},
                headers=auth(token(*MANAGER)))

    # Self and admin can view.
    assert client.get("/api/pm-score/dev-plans", params={"employeeId": "David Chen", "fiscalYear": FY},
                      headers=auth(token(*EMPLOYEE))).status_code == 200
    assert client.get("/api/pm-score/dev-plans", params={"employeeId": "David Chen", "fiscalYear": FY},
                      headers=auth(token(*ADMIN))).status_code == 200

    # An unrelated employee cannot (this endpoint had NO check before).
    outsider = token("employee", "Priya Nair")
    r = client.get("/api/pm-score/dev-plans", params={"employeeId": "David Chen", "fiscalYear": FY},
                   headers=auth(outsider))
    assert r.status_code == 403
