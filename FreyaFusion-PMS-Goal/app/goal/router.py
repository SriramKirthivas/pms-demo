"""pm-goal REST API (context path /api/pm-goal). Returns BaseRspVO envelopes."""

from fastapi import APIRouter, Depends, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from ..common.auth import CurrentUser, get_current_user
from ..common.envelope import ok, page
from ..common.internal import require_internal
from . import schemas, service, xlsx_io
from ..common.db import get_session

router = APIRouter(prefix="/api/pm-goal", tags=["pm-goal"])


@router.post("/framework")
def configure_framework(
    payload: schemas.FrameworkCreate,
    db: Session = Depends(get_session),
    user: CurrentUser = Depends(get_current_user),
) -> dict:
    fw = service.configure_framework(db, payload, user)
    return ok(service.framework_out(db, fw))


@router.get("/framework")
def get_framework(
    fiscalYear: str,
    db: Session = Depends(get_session),
    user: CurrentUser = Depends(get_current_user),
) -> dict:
    fw = service.get_framework(db, fiscalYear)
    return ok(service.framework_out(db, fw) if fw else None)


@router.get("/periods")
def list_periods(
    fiscalYear: str,
    db: Session = Depends(get_session),
    user: CurrentUser = Depends(get_current_user),
) -> dict:
    return ok([service.period_out(p) for p in service.list_periods(db, fiscalYear)])


# --- Goals ---

@router.post("/goals")
def create_goal(
    payload: schemas.GoalCreate,
    db: Session = Depends(get_session),
    user: CurrentUser = Depends(get_current_user),
) -> dict:
    return ok(service.goal_out(service.create_goal(db, payload, user)))


@router.get("/goals")
def list_goals(
    fiscalYear: str | None = None,
    pillar: str | None = None,
    cadence: str | None = None,
    pageNum: int = 1,
    pageSize: int = 20,
    db: Session = Depends(get_session),
    user: CurrentUser = Depends(get_current_user),
) -> dict:
    rows, total = service.list_goals_page(db, fiscalYear, pillar, cadence, pageNum, pageSize)
    return ok(page([service.goal_out(g) for g in rows], total, pageNum, pageSize))


@router.put("/goals/{goal_id}")
def edit_goal(
    goal_id: str,
    payload: schemas.GoalUpdate,
    db: Session = Depends(get_session),
    user: CurrentUser = Depends(get_current_user),
) -> dict:
    return ok(service.goal_out(service.edit_goal(db, goal_id, payload, user)))


@router.post("/goals/{goal_id}/cascade")
def cascade_goal(
    goal_id: str,
    payload: schemas.CascadeRequest,
    db: Session = Depends(get_session),
    user: CurrentUser = Depends(get_current_user),
) -> dict:
    result = service.cascade_goal(db, goal_id, payload.employeeIds, user, payload.reviewerIds)
    return ok(result)


# --- Goal sheet import / export ---

@router.post("/goals/import")
async def import_goals(
    fiscalYear: str,
    file: UploadFile,
    db: Session = Depends(get_session),
    user: CurrentUser = Depends(get_current_user),
) -> dict:
    content = await file.read()
    result = xlsx_io.import_workbook(db, content, fiscalYear, user)
    return ok(result)


@router.get("/goals/export")
def export_goals(
    employeeId: str,
    fiscalYear: str,
    db: Session = Depends(get_session),
    user: CurrentUser = Depends(get_current_user),
):
    content = xlsx_io.export_workbook(db, employeeId, fiscalYear)
    filename = f"goals_{employeeId}_{fiscalYear}.xlsx".replace(" ", "_")
    return StreamingResponse(
        iter([content]),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# --- Employee directory (UAM stub — see models.Employee) ---

@router.get("/people")
def list_people(
    managerId: str | None = None,
    department: str | None = None,
    q: str | None = None,
    db: Session = Depends(get_session),
    user: CurrentUser = Depends(get_current_user),
) -> dict:
    return ok([service.employee_out(e) for e in service.list_people(db, user, managerId, department, q)])


@router.post("/people")
def upsert_employee(
    payload: schemas.EmployeeUpsert,
    db: Session = Depends(get_session),
    user: CurrentUser = Depends(get_current_user),
) -> dict:
    return ok(service.employee_out(service.upsert_employee(db, payload, user)))


# --- Assignments + bilateral acceptance ---

@router.get("/assignments")
def list_assignments(
    employeeId: str | None = None,
    periodId: str | None = None,
    status: str | None = None,
    db: Session = Depends(get_session),
    user: CurrentUser = Depends(get_current_user),
) -> dict:
    rows = service.list_assignments(db, user, employeeId, status, periodId)
    return ok([service.assignment_out(a) for a in rows])


@router.get("/assignments/{assignment_id}")
def get_assignment(
    assignment_id: str,
    db: Session = Depends(get_session),
    user: CurrentUser = Depends(get_current_user),
) -> dict:
    return ok(service.assignment_out(service.get_assignment(db, assignment_id)))


@router.post("/assignments/{assignment_id}/accept")
def accept(
    assignment_id: str,
    db: Session = Depends(get_session),
    user: CurrentUser = Depends(get_current_user),
) -> dict:
    return ok(service.assignment_out(service.accept(db, assignment_id, user)))


@router.post("/assignments/{assignment_id}/request-change")
def request_change(
    assignment_id: str,
    payload: schemas.RequestChange,
    db: Session = Depends(get_session),
    user: CurrentUser = Depends(get_current_user),
) -> dict:
    return ok(service.assignment_out(service.request_change(db, assignment_id, payload, user)))


@router.post("/assignments/{assignment_id}/reject")
def reject(
    assignment_id: str,
    db: Session = Depends(get_session),
    user: CurrentUser = Depends(get_current_user),
) -> dict:
    return ok(service.assignment_out(service.reject(db, assignment_id, user)))


@router.post("/assignments/{assignment_id}/request-completion")
def request_completion(
    assignment_id: str,
    payload: schemas.CompletionRequest,
    db: Session = Depends(get_session),
    user: CurrentUser = Depends(get_current_user),
) -> dict:
    return ok(service.assignment_out(service.request_completion(db, assignment_id, payload, user)))


@router.post("/assignments/{assignment_id}/completion-decision")
def completion_decision(
    assignment_id: str,
    payload: schemas.CompletionDecision,
    db: Session = Depends(get_session),
    user: CurrentUser = Depends(get_current_user),
) -> dict:
    return ok(service.assignment_out(service.decide_completion(db, assignment_id, payload, user)))


@router.get("/assignments/{assignment_id}/audit")
def assignment_audit(
    assignment_id: str,
    db: Session = Depends(get_session),
    user: CurrentUser = Depends(get_current_user),
) -> dict:
    return ok([service.audit_out(e) for e in service.list_audit(db, assignment_id)])


@router.post("/assignments/{assignment_id}/reassign")
def reassign_assignment(
    assignment_id: str,
    payload: schemas.ReassignRequest,
    db: Session = Depends(get_session),
    user: CurrentUser = Depends(get_current_user),
) -> dict:
    return ok(service.assignment_out(service.reassign_assignment(db, assignment_id, payload, user)))


# --- Mid-cycle joiners / leavers / reassignment ---

@router.post("/participants/{employee_id}/lifecycle")
def participant_lifecycle(
    employee_id: str,
    payload: schemas.LifecycleRequest,
    db: Session = Depends(get_session),
    user: CurrentUser = Depends(get_current_user),
) -> dict:
    return ok(service.lifecycle_event(db, employee_id, payload, user))


# --- Period lock + unlock approval chain ---

@router.post("/periods/{period_id}/lock")
def lock_period(
    period_id: str,
    db: Session = Depends(get_session),
    user: CurrentUser = Depends(get_current_user),
) -> dict:
    return ok(service.lock_period(db, period_id, user))


@router.get("/periods/{period_id}/unlock-requests")
def list_unlock_requests(
    period_id: str,
    status: str | None = None,
    db: Session = Depends(get_session),
    user: CurrentUser = Depends(get_current_user),
) -> dict:
    return ok([service.unlock_request_out(r) for r in service.list_unlock_requests(db, period_id, status)])


@router.post("/periods/{period_id}/unlock-request")
def request_unlock(
    period_id: str,
    payload: schemas.UnlockRequestCreate,
    db: Session = Depends(get_session),
    user: CurrentUser = Depends(get_current_user),
) -> dict:
    return ok(service.unlock_request_out(service.request_unlock(db, period_id, payload, user)))


@router.post("/periods/{period_id}/unlock-request/{req_id}/decision")
def decide_unlock(
    period_id: str,
    req_id: str,
    payload: schemas.UnlockDecision,
    db: Session = Depends(get_session),
    user: CurrentUser = Depends(get_current_user),
) -> dict:
    return ok(service.unlock_request_out(service.decide_unlock(db, period_id, req_id, payload, user)))


# --- System-internal (called by pm-eval / pm-score; no user token) ---

@router.get("/system/employees")
def system_employees(
    ids: str | None = None,  # comma-separated
    db: Session = Depends(get_session),
    _: bool = Depends(require_internal),
) -> dict:
    id_list = [i.strip() for i in ids.split(",") if i.strip()] if ids else None
    return ok([service.employee_out(e) for e in service.directory_lookup(db, id_list)])


@router.get("/system/framework")
def system_framework(
    fiscalYear: str,
    db: Session = Depends(get_session),
    _: bool = Depends(require_internal),
) -> dict:
    fw = service.get_framework(db, fiscalYear)
    return ok(service.framework_out(db, fw) if fw else None)


@router.get("/system/assignments")
def system_assignments(
    employeeId: str,
    fiscalYear: str,
    db: Session = Depends(get_session),
    _: bool = Depends(require_internal),
) -> dict:
    return ok(service.assignments_for(db, employeeId, fiscalYear))


@router.get("/system/assignments/{assignment_id}")
def system_assignment_status(
    assignment_id: str,
    db: Session = Depends(get_session),
    _: bool = Depends(require_internal),
) -> dict:
    return ok(service.system_assignment_status(db, assignment_id))


@router.post("/system/assignments/acknowledge")
def system_acknowledge_assignments(
    payload: schemas.AcknowledgeRequest,
    db: Session = Depends(get_session),
    _: bool = Depends(require_internal),
) -> dict:
    return ok(service.acknowledge_assignments(db, payload))


@router.post("/system/assignments/{assignment_id}/rated")
def system_record_rated(
    assignment_id: str,
    payload: schemas.RatedEvent,
    db: Session = Depends(get_session),
    _: bool = Depends(require_internal),
) -> dict:
    service.record_rated(db, assignment_id, payload)
    return ok(None)


# --- Tenant onboarding (schema/seed only; no external Tenant Manager calls) ---

@router.post("/tenant/onboarding")
def tenant_onboarding(
    db: Session = Depends(get_session),
    _: bool = Depends(require_internal),
) -> dict:
    return ok(service.onboard_tenant(db))


@router.post("/tenant/onboarding/query")
def tenant_onboarding_query(
    db: Session = Depends(get_session),
    _: bool = Depends(require_internal),
) -> dict:
    return ok(service.onboarding_query(db))
