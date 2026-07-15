"""FreyaFusion PMS — Goal Management service (pm-goal).

Framework config, review periods, goal authoring, cascade, bilateral acceptance,
and the goal-lifecycle audit trail. Standalone, independently deployable.
"""

import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

# Owns the pm_goal database.
os.environ.setdefault("SERVICE_DB", "pm_goal")

# Load the APP_ENV profile (config/{APP_ENV}.yml) into the environment before
# any config-reading modules import. No-op unless APP_ENV is set.
from .common.config import load_config  # noqa: E402
load_config()

from .common import db as dbmod  # noqa: E402
from .common.envelope import ApiError  # noqa: E402
from .goal import models  # noqa: E402,F401  (register tables on Base before init)
from .goal.router import router as goal_router  # noqa: E402
from .goal.service import seed_directory_if_empty  # noqa: E402


@asynccontextmanager
async def lifespan(app: FastAPI):
    dbmod.init()
    # Convenience for local/dev: seed the demo employee directory (UAM stub)
    # on startup too, not just via the /tenant/onboarding endpoint, so a
    # freshly-started service is immediately usable without an extra call.
    # dbmod._Session is only assigned once init() has run — must access it
    # via the module, not a name imported before init() ran.
    session = dbmod._Session()
    try:
        seed_directory_if_empty(session)
    finally:
        session.close()
    yield


app = FastAPI(title="FreyaFusion PMS — Goal", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(goal_router)


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "service": "pm-goal"}


@app.exception_handler(ApiError)
async def _api_error_handler(request: Request, exc: ApiError):
    return JSONResponse(
        status_code=exc.status_code,
        content={"code": exc.code, "message": exc.message, "data": None},
    )
