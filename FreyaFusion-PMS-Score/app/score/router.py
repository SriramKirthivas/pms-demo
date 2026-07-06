"""pm-score API (context path /api/pm-score). Returns BaseRspVO envelopes."""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..common.auth import CurrentUser, get_current_user
from ..common.db import get_session
from ..common.envelope import FORBIDDEN, ApiError, ok
from ..common.internal import require_internal
from . import schemas, service

router = APIRouter(prefix="/api/pm-score", tags=["pm-score"])


@router.get("/bands")
def list_bands(
    db: Session = Depends(get_session),
    user: CurrentUser = Depends(get_current_user),
) -> dict:
    return ok(service.list_bands(db))


@router.post("/scorecards/compute")
def compute(
    payload: schemas.ComputeRequest,
    db: Session = Depends(get_session),
    user: CurrentUser = Depends(get_current_user),
) -> dict:
    return ok(service.scorecard_out(db, service.compute(db, payload, user)))


@router.get("/scorecards")
def get_scorecard(
    employeeId: str,
    fiscalYear: str,
    db: Session = Depends(get_session),
    user: CurrentUser = Depends(get_current_user),
) -> dict:
    # Previously any manager/admin could view ANY employee's scorecard, not
    # just their own reports — tightened to a real manager-of relationship
    # (per pm-goal's directory) via service.can_view_employee_data.
    if not service.can_view_employee_data(employeeId, user):
        raise ApiError(403, FORBIDDEN, "Not permitted to view this employee's scorecard")
    sc = service.get_scorecard(db, employeeId, fiscalYear)
    return ok(service.scorecard_out(db, sc) if sc else None)


@router.get("/scorecards/breakdown")
def scorecard_breakdown(
    employeeId: str,
    fiscalYear: str,
    db: Session = Depends(get_session),
    user: CurrentUser = Depends(get_current_user),
) -> dict:
    if not service.can_view_employee_data(employeeId, user):
        raise ApiError(403, FORBIDDEN, "Not permitted to view this employee's scorecard breakdown")
    return ok(service.get_breakdown(db, employeeId, fiscalYear))


@router.get("/scorecards/all")
def all_scorecards(
    fiscalYear: str,
    db: Session = Depends(get_session),
    user: CurrentUser = Depends(get_current_user),
) -> dict:
    if user.role not in ("manager", "admin"):
        raise ApiError(403, FORBIDDEN, "view_ninebox privilege required")
    return ok(service.list_all(db, fiscalYear))


@router.post("/nine-box/place")
def place_nine_box(
    payload: schemas.NineBoxRequest,
    db: Session = Depends(get_session),
    user: CurrentUser = Depends(get_current_user),
) -> dict:
    return ok(service.nine_box_out(service.place_nine_box(db, payload, user)))


@router.get("/nine-box")
def nine_box_matrix(
    fiscalYear: str,
    department: str | None = None,
    db: Session = Depends(get_session),
    user: CurrentUser = Depends(get_current_user),
) -> dict:
    if user.role not in ("manager", "admin"):
        raise ApiError(403, FORBIDDEN, "view_ninebox privilege required")
    return ok(service.list_all(db, fiscalYear, department))


@router.post("/scorecards/{scorecard_id}/acknowledge")
def acknowledge(
    scorecard_id: str,
    db: Session = Depends(get_session),
    user: CurrentUser = Depends(get_current_user),
) -> dict:
    return ok(service.scorecard_out(db, service.acknowledge(db, scorecard_id, user)))


@router.post("/scorecards/{scorecard_id}/signoff")
def signoff(
    scorecard_id: str,
    db: Session = Depends(get_session),
    user: CurrentUser = Depends(get_current_user),
) -> dict:
    return ok(service.scorecard_out(db, service.signoff(db, scorecard_id, user)))


# --- Development plans ---

@router.post("/dev-plans/build")
def build_dev_plan(
    payload: schemas.DevPlanBuildRequest,
    db: Session = Depends(get_session),
    user: CurrentUser = Depends(get_current_user),
) -> dict:
    return ok(service.dev_plan_out(service.build_dev_plan(db, payload, user)))


@router.get("/dev-plans")
def list_dev_plans(
    employeeId: str,
    fiscalYear: str,
    db: Session = Depends(get_session),
    user: CurrentUser = Depends(get_current_user),
) -> dict:
    return ok([service.dev_plan_out(p) for p in service.list_dev_plans(db, employeeId, fiscalYear, user)])


@router.put("/dev-plans/{plan_id}")
def edit_dev_plan(
    plan_id: str,
    payload: schemas.DevPlanUpdate,
    db: Session = Depends(get_session),
    user: CurrentUser = Depends(get_current_user),
) -> dict:
    return ok(service.dev_plan_out(service.edit_dev_plan(db, plan_id, payload, user)))


# --- Calibration ---

@router.post("/calibration/adjust")
def adjust_calibration(
    payload: schemas.CalibrationAdjustRequest,
    db: Session = Depends(get_session),
    user: CurrentUser = Depends(get_current_user),
) -> dict:
    return ok(service.scorecard_out(db, service.adjust_calibration(db, payload, user)))


@router.get("/calibration")
def calibration_view(
    fiscalYear: str,
    department: str | None = None,
    db: Session = Depends(get_session),
    user: CurrentUser = Depends(get_current_user),
) -> dict:
    if user.role not in ("manager", "admin"):
        raise ApiError(403, FORBIDDEN, "calibrate_scorecard privilege required")
    return ok(service.calibration_view(db, fiscalYear, department))


# --- System internal (no token, VPC only) ---

@router.get("/system/scorecards/{employee_id}")
def system_scorecard(
    employee_id: str,
    fiscalYear: str,
    db: Session = Depends(get_session),
    _: bool = Depends(require_internal),
) -> dict:
    sc = service.get_scorecard(db, employee_id, fiscalYear)
    return ok(service.scorecard_out(db, sc) if sc else None)


@router.post("/tenant/onboarding")
def tenant_onboarding(
    payload: schemas.TenantOnboardingRequest,
    db: Session = Depends(get_session),
    _: bool = Depends(require_internal),
) -> dict:
    return ok(service.onboard_tenant(db, payload.tenantId))


@router.post("/tenant/onboarding/query")
def tenant_onboarding_query(
    payload: schemas.TenantOnboardingQuery,
    _: bool = Depends(require_internal),
) -> dict:
    return ok({"status": "COMPLETED"})
