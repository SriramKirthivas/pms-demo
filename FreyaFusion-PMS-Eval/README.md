# FreyaFusion-PMS-Eval

Eval service (pm-eval) of the Freya Fusion PMS module. **Scaffold** — implement per the spec.

- **Stack:** Python / FastAPI (Pydantic + SQLAlchemy), containerised for ECS.
- **Database:** owns `pm_eval` (via `SERVICE_DB`), derived from `DATABASE_URL`.
- **Responses:** URF `BaseRspVO { code, message, data }` envelope.
- **Auth:** verifies the shared JWT (`SECRET_KEY`).

## Run / test
```bash
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000   # GET /api/health, /api/pm-eval/ping
pytest -q
```

Context path: `/api/pm-eval`.

## Cross-service wiring (v2)
Service-to-service calls use an internal `httpx` client (`app/common/internal.py`),
best-effort so a sibling being down never breaks the local operation.

Env: `GOAL_URL`, `EVAL_URL`, `SCORE_URL`, `NOTIFY_URL` (sibling origins),
`INTERNAL_TOKEN` + `INTERNAL_ENFORCE=1` (guard `/system/*` in prod).

Chain: Goal `POST /periods/{id}/lock` → Eval `POST /system/periods/{id}/finalize`;
Score `POST /scorecards/compute` pulls Goal `/system/assignments` + Eval
`/system/evaluations/final`; all services emit events to Notify `/system/events`.
