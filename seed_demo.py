"""Seed demo data into the running pm-* services.

Drives the REAL service APIs with signed JWTs (same SECRET_KEY the services
verify) so the frontend shows a populated Dashboard, Goals, Scorecard, Talent
(9-box), Feedback and notification bell. Idempotent-ish: safe to re-run.

Point it at local or deployed services via env vars (defaults = local dev):
    GOAL=http://127.0.0.1:8001  EVAL=...:8002  SCORE=...:8003  NOTIFY=...:8004
    SECRET_KEY=dev-secret
Fiscal year matches the frontend constant CURRENT_FY = "FY26-27".
"""

import os
import sys
from datetime import datetime, timezone

import httpx
import jwt

SECRET = os.getenv("SECRET_KEY", "dev-secret")
FY = "FY26-27"
GOAL = os.getenv("GOAL", "http://127.0.0.1:8001").rstrip("/")
EVAL = os.getenv("EVAL", "http://127.0.0.1:8002").rstrip("/")
SCORE = os.getenv("SCORE", "http://127.0.0.1:8003").rstrip("/")
NOTIFY = os.getenv("NOTIFY", "http://127.0.0.1:8004").rstrip("/")

ADMIN = ("admin", "Nina Patel")
MANAGER = ("manager", "Sarah Mitchell")


def tok(role: str, name: str) -> str:
    now = int(datetime.now(timezone.utc).timestamp())
    return jwt.encode(
        {"sub": name.replace(" ", ".").lower() + "@company.com", "name": name,
         "role": role, "country": "IE", "iat": now},
        SECRET, algorithm="HS256",
    )


def hdr(t: str) -> dict:
    return {"Authorization": f"Bearer {t}"}


A = tok(*ADMIN)
M = tok(*MANAGER)


def data(r: httpx.Response):
    """Unwrap a BaseRspVO envelope; raise on non-200."""
    r.raise_for_status()
    body = r.json()
    if isinstance(body, dict) and "code" in body and body["code"] not in (200, "200"):
        raise RuntimeError(f"{r.request.method} {r.request.url} -> {body}")
    return body.get("data") if isinstance(body, dict) else body


def as_list(d):
    """GET endpoints may return a bare list or a paginated {list,total,...}."""
    if isinstance(d, dict):
        return d.get("list", [])
    return d or []


# name, role, 9-box potential (1..3), team manager score, individual manager score
PEOPLE = [
    ("David Chen",     "employee", 3, 4.0, 4.5),
    ("Sarah Mitchell", "manager",  3, 4.2, 4.3),
    ("Nina Patel",     "admin",    2, 3.9, 4.0),
    ("Marco Rossi",    "employee", 2, 3.2, 3.5),
    ("Aisha Khan",     "employee", 3, 3.6, 3.8),
    ("Liam O'Brien",   "employee", 1, 2.6, 2.8),
    ("Priya Nair",     "employee", 2, 4.4, 4.6),
    ("Tom Baker",      "employee", 1, 3.0, 2.9),
]
NAMES = [p[0] for p in PEOPLE]


def step(m):
    print(f"  {m}", flush=True)


def main():
    with httpx.Client(timeout=60) as c:
        # 1) Framework -------------------------------------------------------
        print("[1/7] Framework + periods", flush=True)
        try:
            fw = data(c.post(f"{GOAL}/api/pm-goal/framework", headers=hdr(A), json={
                "fiscalYear": FY, "activeCadences": ["QUARTERLY", "ANNUAL"],
                "teamWeightPct": 60, "individualWeightPct": 40}))
            step(f"periods: {sorted(p['code'] for p in fw['periods'])}")
        except Exception as e:  # noqa: BLE001
            step(f"framework skipped/exists: {e}")

        # 2) Goals (idempotent by measure) -----------------------------------
        print("[2/7] Goals", flush=True)
        specs = [
            ("TEAM_GOAL", "Improve platform reliability to 99.95% uptime", "Reduce Sev-1 incidents.", 5),
            ("TEAM_GOAL", "Cut incident MTTR by 30%", "Faster detection and rollback.", 5),
            ("INDIVIDUAL_CONTRIBUTION", "Ship Auth Service v2 to GA", "Deliver the new session service.", 5),
            ("INDIVIDUAL_CONTRIBUTION", "Mentor two junior engineers", "Weekly 1:1s and coaching.", 5),
        ]
        existing = {g.get("measure"): g.get("id")
                    for g in as_list(data(c.get(f"{GOAL}/api/pm-goal/goals",
                                                headers=hdr(A), params={"fiscalYear": FY})))}
        goal_ids, made = [], 0
        for pillar, measure, desc, w in specs:
            if existing.get(measure):
                goal_ids.append(existing[measure]); continue
            g = data(c.post(f"{GOAL}/api/pm-goal/goals", headers=hdr(A), json={
                "fiscalYear": FY, "pillar": pillar, "cadence": "QUARTERLY",
                "measure": measure, "description": desc, "defaultWeight": w}))
            goal_ids.append(g["id"]); made += 1
        step(f"{made} created, {len(goal_ids) - made} reused")

        # 3) Cascade + bilateral acceptance ----------------------------------
        print("[3/7] Cascade + acceptance", flush=True)
        first_aid = {}
        activated = 0
        for gid in goal_ids:
            res = data(c.post(f"{GOAL}/api/pm-goal/goals/{gid}/cascade", headers=hdr(A),
                              json={"employeeIds": NAMES, "reviewerIds": ["Rachel Adams"]}))
            for aid in res.get("created", []):
                a = data(c.get(f"{GOAL}/api/pm-goal/assignments/{aid}", headers=hdr(A)))
                emp = a["employeeId"]
                first_aid.setdefault(emp, aid)
                cp = A if emp != "Nina Patel" else M
                data(c.post(f"{GOAL}/api/pm-goal/assignments/{aid}/accept", headers=hdr(tok('employee', emp))))
                fin = data(c.post(f"{GOAL}/api/pm-goal/assignments/{aid}/accept", headers=hdr(cp)))
                if fin.get("status") == "ACTIVE":
                    activated += 1
            if res.get("failed"):
                step(f"  cascade failures: {res['failed']}")
        step(f"activated {activated} assignments")

        # 4) Continuous feedback ---------------------------------------------
        print("[4/7] Feedback", flush=True)
        fb = [
            ("David Chen", "MOTIVATION", "Outstanding ownership on the reliability push."),
            ("David Chen", "STRETCH", "Ready to lead the Auth v2 rollout end-to-end."),
            ("Marco Rossi", "IMPROVEMENT", "Great UI work; tighten test coverage next quarter."),
            ("Aisha Khan", "MOTIVATION", "Excellent analysis that reshaped the roadmap."),
            ("Sarah Mitchell", "MOTIVATION", "Strong cross-team leadership this half."),
            ("Priya Nair", "STRETCH", "Consistently exceeds — candidate for a stretch project."),
        ]
        n = 0
        for about, cat, text in fb:
            try:
                data(c.post(f"{EVAL}/api/pm-eval/feedback", headers=hdr(M), json={
                    "aboutEmployeeId": about, "category": cat, "text": text, "fiscalYear": FY}))
                n += 1
            except Exception as e:  # noqa: BLE001
                step(f"  feedback {about} skipped: {e}")
        step(f"{n} notes")

        # 5) Evaluations ------------------------------------------------------
        print("[5/7] Evaluations", flush=True)
        n = 0
        for name, role, pot, team, indiv in PEOPLE:
            aid = first_aid.get(name)
            if not aid:
                continue
            try:
                data(c.post(f"{EVAL}/api/pm-eval/evaluations/self", headers=hdr(tok(role, name)),
                            json={"assignmentId": aid, "employeeId": name, "rating": round(min(5, team + 0.3), 2)}))
                data(c.post(f"{EVAL}/api/pm-eval/evaluations/reviewer", headers=hdr(M),
                            json={"assignmentId": aid, "employeeId": name, "rating": round(team, 2)}))
                n += 1
            except Exception as e:  # noqa: BLE001
                step(f"  eval {name} skipped: {e}")
        step(f"{n} people rated")

        # 6) Scorecards (sections override) + 9-box --------------------------
        print("[6/7] Scorecards + 9-box", flush=True)
        n = 0
        for name, role, pot, team, indiv in PEOPLE:
            sections = [
                {"ipfWeight": 60, "selfScore": round(min(5, team + 0.2), 2), "managerScore": team},
                {"ipfWeight": 40, "selfScore": round(min(5, indiv + 0.2), 2), "managerScore": indiv},
            ]
            sc = data(c.post(f"{SCORE}/api/pm-score/scorecards/compute", headers=hdr(M),
                             json={"employeeId": name, "fiscalYear": FY, "sections": sections}))
            data(c.post(f"{SCORE}/api/pm-score/nine-box/place", headers=hdr(M), json={
                "employeeId": name, "fiscalYear": FY, "potentialLevel": pot,
                "department": {"David Chen": "Engineering", "Marco Rossi": "Engineering",
                               "Aisha Khan": "Analytics"}.get(name, "General")}))
            n += 1
            step(f"  {name}: IPF {sc.get('managerFinalIPF')} ({sc.get('bandManager','')})  potential L{pot}")
        step(f"{n} scorecards + 9-box")

        # 7) Notifications for the bell (direct, best-effort) ----------------
        print("[7/7] Notifications", flush=True)
        n = 0
        import uuid
        notes = [
            ("David Chen", "SCORECARD_PUBLISHED", "Your scorecard is ready", "Final IPF 4.20 — Exceeds Expectations."),
            ("David Chen", "GOAL_CASCADED", "New goals assigned", "4 goals for FY26-27 need your acceptance."),
            ("Sarah Mitchell", "SCORECARD_PUBLISHED", "Scorecard ready", "Team calibration is open."),
            ("Nina Patel", "PERIOD_LOCKED", "Period locked", "FY26-27 H1 has been locked."),
        ]
        for rid, typ, title, body in notes:
            try:
                c.post(f"{NOTIFY}/api/pm-notify/system/events", json={
                    "eventId": f"evt:{uuid.uuid4().hex}", "type": typ, "recipientId": rid,
                    "title": title, "body": body, "href": "/dashboard"})
                n += 1
            except Exception:  # noqa: BLE001
                pass
        step(f"{n} notifications")

        print("\nDONE. Log in and check Dashboard / Goals / Scorecard / Talent / Feedback.", flush=True)


if __name__ == "__main__":
    try:
        main()
    except httpx.HTTPStatusError as e:
        print(f"HTTP error: {e.response.status_code} {e.response.text[:300]}", file=sys.stderr)
        sys.exit(1)
