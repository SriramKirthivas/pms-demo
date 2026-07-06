"""Legacy /api backend shim for the FreyaFusion PMS demo.

The React dashboard talks to two backends:
  * the four pm-* services (Goal/Eval/Score/Notify) — envelope-wrapped, own the
    real domain data.
  * a separate "legacy" backend at /api/* (raw JSON) that owns a handful of
    ancillary pages (people, team, company-goals, competencies, development,
    audit) plus /login + /me. That service is NOT part of the five repos.

This shim implements just enough of that legacy backend so the ancillary pages
render with sample data during the demo. It also mints a JWT signed with the
SAME shared SECRET_KEY the pm-* services verify (in case the client-side dev
login is disabled), so its tokens are accepted by the real four services.

Run:  uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}
"""

import os
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret")
ALGORITHM = "HS256"
DEMO_PASSWORD = os.getenv("DEMO_PASSWORD", "demo1234")

# email -> persona (mirrors the frontend src/lib/roles.ts personas)
PERSONAS = {
    "d.chen@company.com": {"name": "David Chen", "role": "employee", "country": "IE",
                           "title": "Backend Engineer", "department": "Engineering",
                           "avatar": "https://storage.googleapis.com/uxpilot-auth.appspot.com/avatars/avatar-3.jpg"},
    "s.mitchell@company.com": {"name": "Sarah Mitchell", "role": "manager", "country": "IE",
                               "title": "Sr. Product Manager", "department": "Product & Strategy",
                               "avatar": "https://storage.googleapis.com/uxpilot-auth.appspot.com/avatars/avatar-1.jpg"},
    "n.patel@company.com": {"name": "Nina Patel", "role": "admin", "country": "IE",
                            "title": "HR Business Partner", "department": "People Operations",
                            "avatar": "https://storage.googleapis.com/uxpilot-auth.appspot.com/avatars/avatar-7.jpg"},
}
FALLBACK_AVATAR = "https://storage.googleapis.com/uxpilot-auth.appspot.com/avatars/avatar-2.jpg"

app = FastAPI(title="FreyaFusion PMS — legacy /api shim (demo)")
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_credentials=False,
    allow_methods=["*"], allow_headers=["*"],
)


def _persona_for(email: str) -> dict:
    return PERSONAS.get(email.lower().strip(), {
        "name": email.split("@")[0].replace(".", " ").title() or "Demo User",
        "role": "employee", "country": "IE",
        "title": "Team Member", "department": "General", "avatar": FALLBACK_AVATAR,
    })


def _mint(email: str, p: dict) -> str:
    now = datetime.now(timezone.utc)
    return jwt.encode({
        "sub": email, "name": p["name"], "role": p["role"], "country": p["country"],
        "iat": int(now.timestamp()), "exp": int((now + timedelta(hours=12)).timestamp()),
    }, SECRET_KEY, algorithm=ALGORITHM)


# ---------------------------------------------------------------- auth --------
class LoginBody(BaseModel):
    email: str
    password: str = ""


@app.post("/api/login")
def login(body: LoginBody):
    if not body.email.strip():
        raise HTTPException(status_code=400, detail="Email is required")
    if not body.password:
        raise HTTPException(status_code=401, detail="Password is required")
    email = body.email.lower().strip()
    p = _persona_for(email)
    return {
        "token": _mint(email, p),
        "user": {"name": p["name"], "email": email, "role": p["role"], "country": p["country"]},
    }


@app.get("/api/me")
def me():
    # Talent page reads this as an access "Scope". Global scope over a few countries.
    return {
        "zone": "EMEA", "isGlobal": True, "allowedCountries": None,
        "countryLabels": {"IE": "Ireland", "GB": "United Kingdom", "US": "United States",
                          "DE": "Germany", "IN": "India"},
    }


# -------------------------------------------------------------- ancillary -----
_PEOPLE = [
    {"name": "David Chen", "title": "Backend Engineer", "dept": "Engineering",
     "avatar": PERSONAS["d.chen@company.com"]["avatar"]},
    {"name": "Sarah Mitchell", "title": "Sr. Product Manager", "dept": "Product & Strategy",
     "avatar": PERSONAS["s.mitchell@company.com"]["avatar"]},
    {"name": "Nina Patel", "title": "HR Business Partner", "dept": "People Operations",
     "avatar": PERSONAS["n.patel@company.com"]["avatar"]},
    {"name": "Marco Rossi", "title": "Frontend Engineer", "dept": "Engineering", "avatar": FALLBACK_AVATAR},
    {"name": "Aisha Khan", "title": "Data Analyst", "dept": "Analytics", "avatar": FALLBACK_AVATAR},
]


@app.get("/api/people")
def people():
    return [{"name": p["name"]} for p in _PEOPLE]


@app.get("/api/people/directory")
def people_directory():
    return _PEOPLE


_TEAM = {
    "teamName": "Product Squad", "department": "Product & Strategy",
    "reviewCycle": "FY2026 — Half-Yearly", "calibration": "9-Box Talent Review",
    "members": [
        {"name": "Sarah Mitchell", "role": "Sr. Product Manager", "email": "s.mitchell@company.com",
         "access": "Manager", "avatar": PERSONAS["s.mitchell@company.com"]["avatar"]},
        {"name": "David Chen", "role": "Backend Engineer", "email": "d.chen@company.com",
         "access": "Contributor", "avatar": PERSONAS["d.chen@company.com"]["avatar"]},
        {"name": "Marco Rossi", "role": "Frontend Engineer", "email": "m.rossi@company.com",
         "access": "Contributor", "avatar": FALLBACK_AVATAR},
    ],
}


@app.get("/api/team")
def team():
    return _TEAM


@app.put("/api/team")
def update_team(body: dict):
    for k in ("teamName", "department", "reviewCycle", "calibration"):
        if k in body:
            _TEAM[k] = body[k]
    return _TEAM


class InviteBody(BaseModel):
    name: str
    email: str
    role: str = ""
    access: str = "Contributor"


@app.post("/api/team/members")
def add_member(body: InviteBody):
    member = {"name": body.name, "role": body.role, "email": body.email,
              "access": body.access, "avatar": FALLBACK_AVATAR}
    _TEAM["members"].append(member)
    known = body.email.lower().strip() in PERSONAS
    return {**member, "loginCreated": not known,
            "loginRole": None if known else "employee",
            "tempPassword": None if known else "welcome123"}


@app.get("/api/company-goals")
def company_goals():
    return [
        {"id": "cg-1", "fy": "FY26-27", "objective": "Grow ARR to $50M",
         "description": "Expand enterprise revenue across EMEA & NA.",
         "metric": "ARR", "target": "$50M", "owner": "Nina Patel", "sortOrder": 1, "alignedGoals": 4},
        {"id": "cg-2", "fy": "FY26-27", "objective": "Ship PMS v2 GA",
         "description": "Launch the new performance module to all tenants.",
         "metric": "Launch", "target": "Q3 FY26", "owner": "Sarah Mitchell", "sortOrder": 2, "alignedGoals": 3},
        {"id": "cg-3", "fy": "FY26-27", "objective": "Raise eNPS to +40",
         "description": "Improve employee engagement and retention.",
         "metric": "eNPS", "target": "+40", "owner": "Nina Patel", "sortOrder": 3, "alignedGoals": 2},
    ]


@app.get("/api/competencies")
def competencies():
    rows = [
        ("Core", "Communication", "Clarity across written & verbal channels.", 4, 4, 20),
        ("Core", "Ownership", "Drives outcomes without being asked.", 4, 3, 20),
        ("Technical", "System Design", "Designs scalable, maintainable services.", 3, 4, 30),
        ("Leadership", "Mentoring", "Grows peers and juniors.", 3, 3, 15),
        ("Leadership", "Strategic Thinking", "Connects work to company goals.", 3, 4, 15),
    ]
    return [{"id": f"c-{i}", "category": c, "name": n, "description": d,
             "selfRating": s, "managerRating": m, "weight": w, "inRadar": True, "sortOrder": i}
            for i, (c, n, d, s, m, w) in enumerate(rows, 1)]


def _dev_plans():
    return [
        {"name": "David Chen", "avatar": PERSONAS["d.chen@company.com"]["avatar"],
         "role": "Backend Engineer", "skills": ["Go", "Distributed Systems", "Kafka"],
         "progress": 65, "courses": 3, "nextReview": "2026-09-15",
         "courseList": [
             {"title": "Advanced Go Concurrency", "provider": "Coursera", "status": "In Progress", "progress": 60},
             {"title": "Designing Data-Intensive Apps", "provider": "O'Reilly", "status": "Completed", "progress": 100},
             {"title": "Kafka Fundamentals", "provider": "Confluent", "status": "Not Started", "progress": 0},
         ]},
        {"name": "Marco Rossi", "avatar": FALLBACK_AVATAR,
         "role": "Frontend Engineer", "skills": ["React", "TypeScript", "Accessibility"],
         "progress": 40, "courses": 2, "nextReview": "2026-09-15",
         "courseList": [
             {"title": "React Performance", "provider": "Frontend Masters", "status": "In Progress", "progress": 40},
             {"title": "Web Accessibility", "provider": "Deque", "status": "Not Started", "progress": 0},
         ]},
    ]


@app.get("/api/development")
def development():
    return _dev_plans()


@app.get("/api/audit")
def audit():
    now = datetime.now(timezone.utc)
    return [
        {"actor": "Nina Patel", "role": "admin", "action": "PERIOD_LOCK", "target": "FY26-27 H1",
         "reason": "Cycle close", "allowed": True, "at": (now - timedelta(hours=2)).isoformat()},
        {"actor": "Sarah Mitchell", "role": "manager", "action": "RATING_SUBMIT", "target": "David Chen",
         "reason": "Mid-year review", "allowed": True, "at": (now - timedelta(hours=5)).isoformat()},
        {"actor": "David Chen", "role": "employee", "action": "PERIOD_UNLOCK", "target": "FY26-27 H1",
         "reason": "Attempted edit after lock", "allowed": False, "at": (now - timedelta(days=1)).isoformat()},
    ]


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "legacy-shim"}
