"""pm-notify API (context path /api/pm-notify). Returns BaseRspVO envelopes."""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..common.auth import CurrentUser, get_current_user
from ..common.db import get_session, init
from ..common.envelope import ok, page
from ..common.internal import require_internal
from . import schemas, service

router = APIRouter(prefix="/api/pm-notify", tags=["pm-notify"])


@router.get("/notifications")
def list_notifications(
    status: str | None = None,
    pageNum: int = 1,
    pageSize: int = 20,
    db: Session = Depends(get_session),
    user: CurrentUser = Depends(get_current_user),
) -> dict:
    rows, total = service.list_page_for(db, user.name, status, pageNum, pageSize)
    return ok(page([service.out(n) for n in rows], total, pageNum, pageSize))


@router.get("/notifications/unread-count")
def unread_count(
    db: Session = Depends(get_session),
    user: CurrentUser = Depends(get_current_user),
) -> dict:
    return ok({"unread": service.unread_count(db, user.name)})


@router.post("/notifications/{notif_id}/read")
def mark_read(
    notif_id: str,
    db: Session = Depends(get_session),
    user: CurrentUser = Depends(get_current_user),
) -> dict:
    return ok(service.out(service.mark_read(db, notif_id, user)))


@router.post("/notifications/read-all")
def mark_all_read(
    db: Session = Depends(get_session),
    user: CurrentUser = Depends(get_current_user),
) -> dict:
    return ok({"marked": service.mark_all_read(db, user)})


@router.get("/preferences")
def get_preferences(
    db: Session = Depends(get_session),
    user: CurrentUser = Depends(get_current_user),
) -> dict:
    return ok(service.get_preferences(db, user.name))


@router.put("/preferences")
def update_preferences(
    payload: schemas.PreferencesIn,
    db: Session = Depends(get_session),
    user: CurrentUser = Depends(get_current_user),
) -> dict:
    return ok(service.update_preferences(db, user.name, payload.preferences))


# System-internal: other services emit events here (in prod via SQS, this is the
# synchronous fallback). Both paths funnel through service.process_event so
# idempotency and delivery logic stay identical.
@router.post("/system/events")
def ingest_event(
    payload: schemas.EventIn,
    db: Session = Depends(get_session),
    _: bool = Depends(require_internal),
) -> dict:
    n = service.process_event(db, payload)
    return ok(service.out(n) if n else None)


# Tenant Manager onboarding (no token, internal/VPC only).
@router.post("/tenant/onboarding")
def tenant_onboarding(payload: dict | None = None) -> dict:
    # Ensures the schema/tables exist for this tenant's database. Nothing
    # employee-specific to seed: notification preferences are lazily
    # defaulted per-employee (see service.get_preferences).
    init()
    return ok({"status": "COMPLETED"})


@router.post("/tenant/onboarding/query")
def tenant_onboarding_query(payload: dict | None = None) -> dict:
    return ok({"status": "COMPLETED"})
