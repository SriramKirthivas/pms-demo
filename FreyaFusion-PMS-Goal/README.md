# FreyaFusion-PMS-Goal

Goal Management service (`pm-goal`) of the Freya Fusion PMS module.

Framework configuration, review periods, goal authoring, cascade to employees,
the bilateral acceptance state machine, and the goal-lifecycle audit trail.

- **Stack:** Python / FastAPI (Pydantic + SQLAlchemy), containerised for ECS.
- **Database:** owns `pm_goal` (set via `SERVICE_DB`); derived from `DATABASE_URL`.
- **Responses:** URF `BaseRspVO { code, message, data }` envelope.
- **Auth:** verifies the shared JWT (`SECRET_KEY`); UAM/Lambda-Authorizer on the platform.

## Run locally
```bash
pip install -r requirements.txt
export DATABASE_URL=postgresql://freya:freya@localhost:5432/postgres
export SECRET_KEY=dev-secret
uvicorn app.main:app --reload --port 8000
```

## Test
```bash
pytest -q
```

## Key endpoints (context path `/api/pm-goal`)
- `POST/GET /framework`, `GET /periods`
- `POST/GET/PUT /goals`, `POST /goals/{id}/cascade` (returns `{created, failed, assignments}`)
- `POST /goals/import` (`.xlsx` upload), `GET /goals/export` (`.xlsx` download)
- `GET /assignments` (filters: `employeeId`, `periodId`, `status`), `.../accept`, `.../request-change`,
  `.../reject`, `.../audit`, `.../reassign`
- `POST /participants/{employeeId}/lifecycle` (JOINER | LEAVER | REASSIGNMENT)
- `POST /periods/{id}/lock`, `POST /periods/{id}/unlock-request`,
  `POST /periods/{id}/unlock-request/{reqId}/decision`

## Cross-service wiring (v2)
Service-to-service calls use an internal `httpx` client (`app/common/internal.py`),
best-effort so a sibling being down never breaks the local operation.

Env: `GOAL_URL`, `EVAL_URL`, `SCORE_URL`, `NOTIFY_URL` (sibling origins),
`INTERNAL_TOKEN` + `INTERNAL_ENFORCE=1` (guard `/system/*` in prod).

Chain: Goal `POST /periods/{id}/lock` → Eval `POST /system/periods/{id}/finalize`;
Goal `POST /periods/{id}/unlock-request/{reqId}/decision` (APPROVE) → Eval
`POST /system/periods/{id}/reopen`;
Score `POST /scorecards/compute` pulls Goal `/system/assignments` + Eval
`/system/evaluations/final`; all services emit events to Notify `/system/events`.

Internal contracts implemented on the Goal side for siblings to call:
`POST /system/assignments/{id}/rated` (Eval → Goal, after each accepted evaluation),
`GET /system/assignments/{id}` (Eval, pre-evaluation status/lock check),
`POST /system/assignments/acknowledge` (Score → Goal, after scorecard acknowledgement),
`POST /tenant/onboarding` + `POST /tenant/onboarding/query` (schema/seed only, synchronous).
