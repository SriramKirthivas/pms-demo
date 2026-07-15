"""pm-eval API (context path /api/pm-eval). Returns BaseRspVO envelopes."""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..common.auth import CurrentUser, get_current_user
from ..common.db import get_session
from ..common.envelope import page as page_envelope
from ..common.envelope import ok
from ..common.internal import require_internal
from . import schemas, service

router = APIRouter(prefix="/api/pm-eval", tags=["pm-eval"])


@router.post("/evaluations/self")
def submit_self(
    payload: schemas.RatingInput,
    db: Session = Depends(get_session),
    user: CurrentUser = Depends(get_current_user),
) -> dict:
    return ok(service.eval_out(service.submit_self(db, payload, user)))


@router.post("/evaluations/reviewer")
def add_reviewer(
    payload: schemas.RatingInput,
    db: Session = Depends(get_session),
    user: CurrentUser = Depends(get_current_user),
) -> dict:
    return ok(service.eval_out(service.add_reviewer(db, payload, user)))


@router.get("/evaluations")
def evaluations(
    assignmentId: str,
    db: Session = Depends(get_session),
    user: CurrentUser = Depends(get_current_user),
) -> dict:
    return ok([service.eval_out(e) for e in service.history(db, assignmentId, user)])


@router.get("/evaluations/current")
def current(
    assignmentId: str,
    db: Session = Depends(get_session),
    user: CurrentUser = Depends(get_current_user),
) -> dict:
    return ok(service.current(db, assignmentId, user))


@router.get("/evaluations/summary")
def evaluations_summary(
    employeeId: str,
    periodId: str,
    db: Session = Depends(get_session),
    user: CurrentUser = Depends(get_current_user),
) -> dict:
    return ok(service.summary(db, employeeId, periodId, user))


@router.post("/feedback")
def log_feedback(
    payload: schemas.FeedbackCreate,
    db: Session = Depends(get_session),
    user: CurrentUser = Depends(get_current_user),
) -> dict:
    return ok(service.feedback_out(service.log_feedback(db, payload, user)))


@router.get("/feedback")
def list_feedback(
    aboutEmployeeId: str,
    category: str | None = None,
    assignmentId: str | None = None,
    scope: str | None = None,  # "goal" | "continuous"
    pageNum: int = 1,
    pageSize: int = 20,
    db: Session = Depends(get_session),
    user: CurrentUser = Depends(get_current_user),
) -> dict:
    rows, total = service.list_feedback_page(
        db, about=aboutEmployeeId, category=category, assignment_id=assignmentId, scope=scope,
        page_num=pageNum, page_size=pageSize, user=user,
    )
    return ok(page_envelope([service.feedback_out(f) for f in rows], total, pageNum, pageSize))


@router.get("/feedback/mine")
def my_feedback(
    db: Session = Depends(get_session),
    user: CurrentUser = Depends(get_current_user),
) -> dict:
    return ok([service.feedback_out(f) for f in service.list_feedback(db, author=user.name)])


# --- Quarterly check-in notes ---

@router.post("/check-in-notes")
def add_checkin_note(
    payload: schemas.CheckInNoteCreate,
    db: Session = Depends(get_session),
    user: CurrentUser = Depends(get_current_user),
) -> dict:
    return ok(service.checkin_note_out(service.add_checkin_note(db, payload, user)))


@router.get("/check-in-notes")
def list_checkin_notes(
    employeeId: str,
    periodId: str | None = None,
    db: Session = Depends(get_session),
    user: CurrentUser = Depends(get_current_user),
) -> dict:
    return ok([service.checkin_note_out(n) for n in service.list_checkin_notes(db, employeeId, periodId, user)])


# --- Mid-year review checkpoint (read-only) ---

@router.get("/mid-year")
def mid_year(
    employeeId: str,
    fiscalYear: str,
    db: Session = Depends(get_session),
    user: CurrentUser = Depends(get_current_user),
) -> dict:
    return ok(service.mid_year_summary(db, employeeId, fiscalYear, user))


# --- System-internal (called by pm-goal on lock, pm-score at roll-up) ---

@router.post("/system/periods/{period_id}/finalize")
def finalize(
    period_id: str,
    payload: schemas.FinalizeRequest,
    db: Session = Depends(get_session),
    _: bool = Depends(require_internal),
) -> dict:
    marked = service.finalize(db, period_id, payload.assignmentIds)
    return ok({"periodId": period_id, "finalized": marked})


@router.post("/system/periods/{period_id}/reopen")
def reopen(
    period_id: str,
    db: Session = Depends(get_session),
    _: bool = Depends(require_internal),
) -> dict:
    reopened = service.reopen(db, period_id)
    return ok({"periodId": period_id, "reopened": reopened})


@router.get("/system/evaluations/final")
def final_evaluations(
    employeeId: str,
    db: Session = Depends(get_session),
    _: bool = Depends(require_internal),
) -> dict:
    return ok(service.finals(db, employeeId))


@router.get("/system/evaluations/latest")
def latest_evaluations(
    employeeId: str,
    db: Session = Depends(get_session),
    _: bool = Depends(require_internal),
) -> dict:
    return ok(service.latest_by_assignment(db, employeeId))


@router.get("/system/check-in-notes")
def system_checkin_notes(
    employeeId: str,
    fiscalYear: str,
    db: Session = Depends(get_session),
    _: bool = Depends(require_internal),
) -> dict:
    return ok(service.checkin_notes_for_year(db, employeeId, fiscalYear))


@router.get("/system/feedback")
def system_feedback(
    aboutEmployeeId: str,
    fiscalYear: str,
    db: Session = Depends(get_session),
    _: bool = Depends(require_internal),
) -> dict:
    return ok(service.feedback_by_category(db, aboutEmployeeId, fiscalYear))


# --- Tenant onboarding (pure local DB/schema/seed logic; no external Tenant
# Manager registration — that requires the real URF platform, out of scope) ---

@router.post("/system/tenants/onboard")
def onboard_tenant(
    payload: schemas.TenantOnboardingRequest,
    db: Session = Depends(get_session),
    _: bool = Depends(require_internal),
) -> dict:
    return ok(service.tenant_onboarding_out(service.onboard_tenant(db, payload.tenantId), payload.tenantId))


@router.get("/system/tenants/{tenant_id}")
def tenant_status(
    tenant_id: str,
    db: Session = Depends(get_session),
    _: bool = Depends(require_internal),
) -> dict:
    return ok(service.tenant_status(db, tenant_id))
