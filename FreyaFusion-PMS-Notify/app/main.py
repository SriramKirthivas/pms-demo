"""FreyaFusion PMS — Notify service (pm-notify). Scaffold — implement per spec."""

import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

os.environ.setdefault("SERVICE_DB", "pm_notify")

from .common.db import init  # noqa: E402
from .common.envelope import ApiError  # noqa: E402
from .notify import models  # noqa: E402,F401  (register tables before init)
from .notify.router import router as domain_router  # noqa: E402
from .notify.sqs_consumer import start_consumer, stop_consumer  # noqa: E402


@asynccontextmanager
async def lifespan(app: FastAPI):
    init()
    start_consumer()
    yield
    await stop_consumer()


app = FastAPI(title="FreyaFusion PMS — Notify", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_credentials=False,
    allow_methods=["*"], allow_headers=["*"],
)
app.include_router(domain_router)


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "service": "pm-notify"}


@app.exception_handler(ApiError)
async def _api_error_handler(request: Request, exc: ApiError):
    return JSONResponse(
        status_code=exc.status_code,
        content={"code": exc.code, "message": exc.message, "data": None},
    )
