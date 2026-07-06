# Test Cases — FreyaFusion-PMS-Goal

**Service:** Goal Management (`pm-goal`) · context path `/api/pm-goal`

## How to execute

**Automated (fastest — runs all cases below):**
```bash
pip install -r requirements.txt
python -m pytest -q
```

**Manual (API — curl/Postman):** start the service, then mint a JWT for the role you
need (SECRET_KEY must match the running service):
```bash
export DATABASE_URL=postgresql://freya:freya@localhost:5432/postgres SECRET_KEY=dev-secret
uvicorn app.main:app --port 8000 &
# token helper (needs: pip install PyJWT)
tok(){ python3 -c "import jwt,sys;print(jwt.encode({'sub':'u@x.com','name':sys.argv[2],'role':sys.argv[1],'country':'IE'},'dev-secret',algorithm='HS256'))" "$1" "$2"; }
ADMIN=$(tok admin "Nina Patel"); MGR=$(tok manager "Sarah Mitchell"); EMP=$(tok employee "David Chen")
```
Roles: **admin** = HR/Admin, **manager** = setter/reviewer, **employee** = David Chen (owner).

## Cases

| ID | Title | Precondition | Steps | Expected |
|---|---|---|---|---|
| TC-G-01 | Health check | Service up | `GET /api/health` | 200, `service = pm-goal` |
| TC-G-02 | Framework config is admin-only | — | `POST /api/pm-goal/framework` as **manager**, body `{fiscalYear:"FY26-27"}` | 403, `code = FORBIDDEN` |
| TC-G-03 | Weights must total 100 | — | `POST /framework` as admin, `teamWeightPct:70, individualWeightPct:40` | 400, `code = PARAM_INVALID` |
| TC-G-04 | Configure derives periods | — | `POST /framework` as admin, `activeCadences:["QUARTERLY","ANNUAL"], 60/40` | 200; `data.periods` codes = Q1,Q2,Q3,Q4,ANNUAL |
| TC-G-05 | Reconfigure preserves locked periods | Framework exists, Q1 locked | `POST /framework` as admin with `activeCadences:["ANNUAL"]` | Q1 still present (locked); Q2–Q4 removed; ANNUAL present |
| TC-G-06 | Goal authoring is setter-only | — | `POST /api/pm-goal/goals` as **employee** | 403 |
| TC-G-07 | Cascade blocked if section weight ≠ 10 | One TEAM_GOAL goal weight 5 | `POST /goals/{id}/cascade {employeeIds:["David Chen"]}` as admin | 400, `PARAM_INVALID` (must total 10) |
| TC-G-08 | Cascade succeeds at weight 10 | Two TEAM_GOAL goals summing to 10 | `POST /goals/{id}/cascade` as admin | 200; assignment `status = PENDING_ACCEPTANCE` |
| TC-G-09 | Owner cannot be own reviewer | Section = 10 | Cascade to the **setter's own name** | 409, CONFLICT |
| TC-G-10 | Bilateral acceptance activates | Assignment PENDING | employee `POST /assignments/{id}/accept` → then admin/manager `accept` | after employee: still PENDING; after manager: `status = ACTIVE`, `isActive = true` |
| TC-G-11 | Request-change keeps section = 10 | Assignment exists | owner `POST /assignments/{id}/request-change {weight:10}` | 200, `status = CHANGE_REQUESTED` |
| TC-G-12 | Request-change breaking total rejected | Single goal, weight 10 | owner request-change `{weight:7}` | 400, PARAM_INVALID |
| TC-G-13 | Only owner may request change | Assignment exists | **manager** request-change | 403 |
| TC-G-14 | Reject returns to pending | Assignment exists | owner `POST /assignments/{id}/reject` | `status = PENDING_ACCEPTANCE` |
| TC-G-15 | Audit trail is append-only | Assignment cascaded + accepted | `GET /assignments/{id}/audit` | contains CREATED, CASCADED, ACCEPTED (in order) |

_TC-G-01..15 are covered by the automated suite (`tests/test_goal.py`)._

## Increment 2 — unlock chain, locked-period enforcement, cascade validation,
## cross-service contracts, mid-cycle lifecycle, import/export, API polish

| ID | Title | Expected |
|---|---|---|
| TC-G-16 | Unlock approval chain | manager requests unlock on a locked period (PENDING); employee forbidden; admin APPROVE unlocks the period + calls pm-eval reopen (best-effort) + notifies; admin REJECT keeps it locked; re-deciding conflicts (409) |
| TC-G-17 | Locked-period edit enforcement | accept/reject/request-change on an assignment whose period is locked all return 409 |
| TC-G-18 | Cascade validation response shape | cascade returns `{created, failed, assignments}`; empty/duplicate employeeIds land in `failed` with a reason instead of being silently dropped; owner-as-reviewer is 409; multiple reviewerIds supported |
| TC-G-19 | Cross-service contracts (pm-eval / pm-score) | `POST /system/assignments/{id}/rated` appends a RATED audit entry (404 if missing); `GET /system/assignments/{id}` returns status/owner/reviewers/period-lock shape; `POST /system/assignments/acknowledge` bulk-transitions ACTIVE/LOCKED assignments to ACKNOWLEDGED |
| TC-G-20 | Reassignment + lifecycle | `POST /assignments/{id}/reassign` transfers the REVIEWER participation and audits REASSIGNED; JOINER lifecycle creates partial-year assignments; LEAVER lifecycle closes open assignments and flags partial_year; lifecycle requires a setter role |
| TC-G-21 | Tenant onboarding | `POST /tenant/onboarding` ensures schema exists and returns COMPLETED; `POST /tenant/onboarding/query` returns `{status: COMPLETED}` synchronously |
| TC-G-22 | API polish | `GET /goals` paginates via `PageRspVO`; `GET /assignments` filters by `periodId` |
| TC-G-23 | Goal sheet import / export | `.xlsx` import groups rows into (employeeId, pillar, cadence) sections, rejects a section that doesn't total weight 10 (400, no partial writes), and is idempotent on re-import; `.xlsx` export streams a workbook of an employee's goals for a fiscal year |

_TC-G-16..23 are covered by the automated suite (`tests/test_goal.py`)._
