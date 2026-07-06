"""pm-goal business logic (framework configuration + period derivation)."""

from datetime import datetime, timezone

from sqlalchemy.orm import Session

from ..common import internal
from ..common.auth import CurrentUser
from ..common.envelope import CONFLICT, FORBIDDEN, NOT_FOUND, PARAM_INVALID, ApiError
from . import schemas
from .models import (
    AuditEntry,
    Employee,
    Goal,
    GoalAssignment,
    Participation,
    PerformanceFramework,
    ReviewPeriod,
    UnlockRequest,
)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


SECTION_TOTAL = 10  # weights within a pillar section must total 10
SETTER_ROLES = ("manager", "admin")

# Quarter windows for an Apr–Mar fiscal year.
QUARTERS = [
    ("Q1", "Apr – Jun"),
    ("Q2", "Jul – Sep"),
    ("Q3", "Oct – Dec"),
    ("Q4", "Jan – Mar"),
]
MONTHS = [
    "Apr", "May", "Jun", "Jul", "Aug", "Sep",
    "Oct", "Nov", "Dec", "Jan", "Feb", "Mar",
]


def _desired_periods(cadences: list[str]) -> list[tuple[str, str, str, str]]:
    """(code, cadence, label, window) implied by the active cadences."""
    out: list[tuple[str, str, str, str]] = []
    if "QUARTERLY" in cadences:
        for code, window in QUARTERS:
            out.append((code, "QUARTERLY", f"{code} Review", window))
    if "ANNUAL" in cadences:
        out.append(("ANNUAL", "ANNUAL", "Annual Review", "Full Year"))
    if "MONTHLY" in cadences:
        for i, m in enumerate(MONTHS, start=1):
            out.append((f"M{i:02d}", "MONTHLY", m, m))
    # AD_HOC: no auto-derived periods.
    return out


def get_framework(db: Session, fiscal_year: str) -> PerformanceFramework | None:
    return (
        db.query(PerformanceFramework)
        .filter_by(fiscal_year=fiscal_year, is_delete=False)
        .first()
    )


def list_periods(db: Session, fiscal_year: str) -> list[ReviewPeriod]:
    return (
        db.query(ReviewPeriod)
        .filter_by(fiscal_year=fiscal_year, is_delete=False)
        .order_by(ReviewPeriod.code)
        .all()
    )


def _resolve_period(db: Session, fiscal_year: str, cadence: str) -> ReviewPeriod | None:
    """Resolve the ReviewPeriod an assignment belongs to, given its
    fiscal-year + cadence. Periods for a cadence are undifferentiated slots
    (no calendar binding yet), so we deterministically pick the earliest
    (by code) matching, not-yet-locked period; if all are locked, fall back
    to the earliest matching period so every assignment still has a period."""
    rows = (
        db.query(ReviewPeriod)
        .filter_by(fiscal_year=fiscal_year, cadence=cadence, is_delete=False)
        .order_by(ReviewPeriod.code)
        .all()
    )
    if not rows:
        return None
    for p in rows:
        if not p.locked:
            return p
    return rows[0]


def configure_framework(
    db: Session, p: schemas.FrameworkCreate, user: CurrentUser
) -> PerformanceFramework:
    # Privilege: only HR/Admin may configure the framework.
    if user.role != "admin":
        raise ApiError(403, FORBIDDEN, "manage_framework privilege required")
    if p.teamWeightPct + p.individualWeightPct != 100:
        raise ApiError(400, PARAM_INVALID, "teamWeightPct + individualWeightPct must equal 100")

    fw = get_framework(db, p.fiscalYear)
    if fw is None:
        fw = PerformanceFramework(fiscal_year=p.fiscalYear, create_user=user.name)
        db.add(fw)
    fw.active_cadences = p.activeCadences
    fw.team_weight_pct = p.teamWeightPct
    fw.individual_weight_pct = p.individualWeightPct
    fw.update_user = user.name
    db.flush()  # assign fw.id

    # Derive periods, leaving locked ones untouched (reconfigure rule).
    desired = _desired_periods(p.activeCadences)
    desired_codes = {code for code, *_ in desired}
    existing = list_periods(db, p.fiscalYear)
    by_code = {e.code: e for e in existing}
    for e in existing:
        if e.code not in desired_codes and not e.locked:
            db.delete(e)
    for code, cadence, label, window in desired:
        if code not in by_code:
            db.add(ReviewPeriod(
                framework_id=fw.id, fiscal_year=p.fiscalYear,
                code=code, cadence=cadence, label=label, window=window,
                create_user=user.name,
            ))
    db.commit()
    db.refresh(fw)
    return fw


def period_out(p: ReviewPeriod) -> dict:
    return {
        "id": p.id, "code": p.code, "cadence": p.cadence,
        "label": p.label, "window": p.window, "locked": p.locked,
    }


def framework_out(db: Session, fw: PerformanceFramework) -> dict:
    return {
        "id": fw.id,
        "fiscalYear": fw.fiscal_year,
        "activeCadences": fw.active_cadences,
        "teamWeightPct": fw.team_weight_pct,
        "individualWeightPct": fw.individual_weight_pct,
        "periods": [period_out(p) for p in list_periods(db, fw.fiscal_year)],
    }


# --------------------------------------------------------------------------
# Employee directory — UAM STUB (see models.Employee). Standing in for URF
# UAM, which this service should really delegate identity/org-hierarchy to.
# --------------------------------------------------------------------------

DEMO_DIRECTORY_SEED = [
    # id (display name)   email                        role       managerId          department              country title
    ("Nina Patel",    "n.patel@company.com",    "admin",    "",              "People Operations", "IE", "HR Business Partner"),
    ("Sarah Mitchell","s.mitchell@company.com", "manager",  "Nina Patel",    "Product & Strategy", "IE", "Sr. Product Manager"),
    ("Elena Ruiz",    "e.ruiz@company.com",     "manager",  "Nina Patel",    "Design",             "IE", "Design Lead"),
    ("David Chen",    "d.chen@company.com",     "employee", "Sarah Mitchell","Engineering",        "IE", "Backend Engineer"),
    ("Priya Nair",    "p.nair@company.com",     "employee", "Sarah Mitchell","Engineering",        "IE", "Frontend Engineer"),
    ("Tom Baker",     "t.baker@company.com",    "employee", "Sarah Mitchell","Engineering",        "IE", "QA Engineer"),
    ("Marcus Webb",   "m.webb@company.com",     "employee", "Elena Ruiz",    "Design",             "IE", "UX Designer"),
]


def employee_out(e: Employee) -> dict:
    return {
        "id": e.id, "employeeId": e.id, "email": e.email, "role": e.role,
        "managerId": e.manager_id, "department": e.department,
        "country": e.country, "title": e.title,
    }


def seed_directory_if_empty(db: Session) -> int:
    """Idempotently seed a small demo org so cascade targets, department
    filters, and the manager/report relationship are meaningful out of the
    box. No-ops if the directory already has any rows (never overwrites
    real data an admin has entered)."""
    if db.query(Employee).first() is not None:
        return 0
    for emp_id, email, role, manager_id, dept, country, title in DEMO_DIRECTORY_SEED:
        db.add(Employee(
            id=emp_id, email=email, role=role, manager_id=manager_id,
            department=dept, country=country, title=title, create_user="system",
        ))
    db.commit()
    return len(DEMO_DIRECTORY_SEED)


def upsert_employee(db: Session, p: schemas.EmployeeUpsert, user: CurrentUser) -> Employee:
    if user.role != "admin":
        raise ApiError(403, FORBIDDEN, "manage_directory privilege required")
    emp_id = p.id.strip()
    if not emp_id:
        raise ApiError(400, PARAM_INVALID, "id is required")
    e = db.query(Employee).filter_by(id=emp_id).first()
    if e is None:
        e = Employee(id=emp_id, create_user=user.name)
        db.add(e)
    e.email = p.email
    e.role = p.role
    e.manager_id = p.managerId
    e.department = p.department
    e.country = p.country
    e.title = p.title
    e.update_user = user.name
    db.commit()
    db.refresh(e)
    return e


def list_people(
    db: Session, user: CurrentUser, manager_id: str | None = None,
    department: str | None = None, q: str | None = None,
) -> list[Employee]:
    """Directory listing, scoped by role since there is no UAM record-level
    restriction to enforce this for us:
    - admin: everyone (optionally filtered).
    - manager/employee with no managerId given: defaults to "my team" (their
      direct reports) plus themselves.
    - explicit managerId: permitted only for admin or the manager themselves.
    """
    query = db.query(Employee).filter_by(is_delete=False)
    if manager_id:
        if user.role != "admin" and manager_id != user.name:
            raise ApiError(403, FORBIDDEN, "Cannot view another manager's team")
        query = query.filter_by(manager_id=manager_id)
    elif user.role != "admin":
        query = query.filter((Employee.manager_id == user.name) | (Employee.id == user.name))
    if department:
        query = query.filter_by(department=department)
    if q:
        needle = q.strip().lower()
        query = query.filter(Employee.id.ilike(f"%{needle}%"))
    return query.order_by(Employee.id).all()


def directory_lookup(db: Session, ids: list[str] | None = None) -> list[Employee]:
    """For sibling services (pm-eval/pm-score/pm-dashboard) via /system/employees."""
    query = db.query(Employee).filter_by(is_delete=False)
    if ids:
        query = query.filter(Employee.id.in_(ids))
    return query.order_by(Employee.id).all()


def _resolve_cascade_target(db: Session, raw: str | None) -> tuple[str | None, str | None]:
    """Validates a cascade target. Returns (employeeId, None) if accepted, or
    (None, reason) if rejected. If the directory has any rows, a target must
    exist in it (real existence check, per spec: unknown employee -> 400).
    If the directory is empty (e.g. a fresh install/tests that haven't seeded
    it), falls back to shape-only validation so cascading still works before
    any directory data exists."""
    if raw is None or not raw.strip():
        return None, "invalid or empty employeeId"
    emp = raw.strip()
    if len(emp) > 200:
        return None, "invalid or empty employeeId"
    directory_populated = db.query(Employee.id).first() is not None
    if directory_populated and db.query(Employee).filter_by(id=emp, is_delete=False).first() is None:
        return None, "unknown employeeId (not found in directory)"
    return emp, None


# --------------------------------------------------------------------------
# Goals, cascade, assignments, and the bilateral acceptance state machine.
# --------------------------------------------------------------------------

def _audit(db: Session, assignment_id: str, actor: str, action: str, detail: str) -> None:
    db.add(AuditEntry(assignment_id=assignment_id, actor=actor, action=action, detail=detail))


def _section_goal_weight(db: Session, fiscal_year: str, pillar: str, cadence: str) -> int:
    """A 'section' is one pillar within one cadence (matching the goal-sheet
    template and xlsx import grouping): e.g. quarterly INDIVIDUAL_CONTRIBUTION
    and annual Section B (also INDIVIDUAL_CONTRIBUTION) are separate sections
    that each total 10 — not one combined pillar budget."""
    rows = (
        db.query(Goal)
        .filter_by(fiscal_year=fiscal_year, pillar=pillar, cadence=cadence, is_delete=False)
        .all()
    )
    return sum(g.default_weight for g in rows)


def create_goal(db: Session, p: schemas.GoalCreate, user: CurrentUser) -> Goal:
    if user.role not in SETTER_ROLES:
        raise ApiError(403, FORBIDDEN, "create_goal privilege required")
    g = Goal(
        fiscal_year=p.fiscalYear, pillar=p.pillar, cadence=p.cadence,
        goal_type=p.goalType, measure=p.measure.strip(), description=p.description.strip(),
        base_criteria=p.baseCriteria.strip(), default_weight=max(0, min(10, p.defaultWeight)),
        competencies=p.competencies, goal_status="DRAFT",
        setter_id=user.name, create_user=user.name,
    )
    if not g.measure:
        raise ApiError(400, PARAM_INVALID, "measure is required")
    db.add(g)
    db.commit()
    db.refresh(g)
    return g


def list_goals(db: Session, fiscal_year=None, pillar=None) -> list[Goal]:
    q = db.query(Goal).filter_by(is_delete=False)
    if fiscal_year:
        q = q.filter_by(fiscal_year=fiscal_year)
    if pillar:
        q = q.filter_by(pillar=pillar)
    return q.order_by(Goal.create_time).all()


def list_goals_page(
    db: Session, fiscal_year=None, pillar=None, cadence=None,
    page_num: int = 1, page_size: int = 20,
) -> tuple[list[Goal], int]:
    q = db.query(Goal).filter_by(is_delete=False)
    if fiscal_year:
        q = q.filter_by(fiscal_year=fiscal_year)
    if pillar:
        q = q.filter_by(pillar=pillar)
    if cadence:
        q = q.filter_by(cadence=cadence)
    total = q.count()
    page_num = max(1, page_num)
    page_size = max(1, page_size)
    rows = (
        q.order_by(Goal.create_time)
        .offset((page_num - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return rows, total


def get_goal(db: Session, goal_id: str) -> Goal:
    g = db.query(Goal).filter_by(id=goal_id, is_delete=False).first()
    if not g:
        raise ApiError(404, NOT_FOUND, "Goal not found")
    return g


def edit_goal(db: Session, goal_id: str, p: schemas.GoalUpdate, user: CurrentUser) -> Goal:
    if user.role not in SETTER_ROLES:
        raise ApiError(403, FORBIDDEN, "edit_goal privilege required")
    g = get_goal(db, goal_id)
    if g.goal_status != "DRAFT":
        raise ApiError(409, CONFLICT, "Only DRAFT goals can be edited")
    if p.measure is not None:
        g.measure = p.measure.strip()
    if p.description is not None:
        g.description = p.description.strip()
    if p.baseCriteria is not None:
        g.base_criteria = p.baseCriteria.strip()
    if p.defaultWeight is not None:
        g.default_weight = max(0, min(10, p.defaultWeight))
    if p.goalType is not None:
        g.goal_type = p.goalType
    if p.competencies is not None:
        g.competencies = p.competencies
    g.update_user = user.name
    db.commit()
    db.refresh(g)
    return g


def cascade_goal(
    db: Session, goal_id: str, employee_ids: list, user: CurrentUser,
    reviewer_ids: list[str] | None = None,
) -> dict:
    if user.role not in SETTER_ROLES:
        raise ApiError(403, FORBIDDEN, "cascade_goal privilege required")
    g = get_goal(db, goal_id)
    # Section weights (goals in this pillar+cadence) must total 10 before cascade.
    if _section_goal_weight(db, g.fiscal_year, g.pillar, g.cadence) != SECTION_TOTAL:
        raise ApiError(400, PARAM_INVALID,
                       f"{g.pillar} section weights must total {SECTION_TOTAL} before cascade")
    if not employee_ids:
        raise ApiError(400, PARAM_INVALID, "employeeIds is required")

    reviewers = [r.strip() for r in (reviewer_ids or []) if r and r.strip()]
    if not reviewers:
        reviewers = [user.name]

    # Owner may not also be a reviewer on the same assignment.
    seen: set[str] = set()
    created: list[GoalAssignment] = []
    failed: list[dict] = []
    period = _resolve_period(db, g.fiscal_year, g.cadence)

    for raw in employee_ids:
        emp, reason = _resolve_cascade_target(db, raw)
        if emp is None:
            failed.append({"employeeId": raw, "reason": reason})
            continue
        if emp in seen:
            failed.append({"employeeId": emp, "reason": "duplicate employeeId in request"})
            continue
        seen.add(emp)
        if emp in reviewers:
            raise ApiError(409, CONFLICT, "Owner cannot be reviewer on the same assignment")

        a = GoalAssignment(
            goal_id=g.id, fiscal_year=g.fiscal_year, period_id=period.id if period else "",
            owner_id=emp, setter_id=user.name, reviewer_id=reviewers[0],
            pillar=g.pillar, cadence=g.cadence, goal_type=g.goal_type,
            measure=g.measure, criteria=g.base_criteria, weight=g.default_weight,
            competencies=g.competencies, assignment_status="PENDING_ACCEPTANCE",
            employee_acceptance="PENDING", manager_acceptance="PENDING",
            create_user=user.name,
        )
        db.add(a)
        db.flush()
        db.add(Participation(assignment_id=a.id, employee_id=emp, role="OWNER"))
        db.add(Participation(assignment_id=a.id, employee_id=user.name, role="SETTER"))
        for rid in reviewers:
            db.add(Participation(assignment_id=a.id, employee_id=rid, role="REVIEWER"))
        _audit(db, a.id, user.name, "CREATED", f"Goal '{g.measure}' created for {emp}")
        _audit(db, a.id, user.name, "CASCADED", f"Cascaded to {emp}")
        created.append(a)

    if created:
        g.goal_status = "CASCADED"
    db.commit()
    for a in created:
        db.refresh(a)
        internal.emit_event(
            "GOAL_CASCADED", a.owner_id,
            "New goal to review",
            f"'{g.measure}' was assigned to you — please review and accept.",
            "/goals",
        )
    return {
        "created": [a.id for a in created],
        "failed": failed,
        "assignments": [assignment_out(a) for a in created],
    }


def _authorized_owner_ids(db: Session, user: CurrentUser) -> set[str] | None:
    """Owner ids the current user may see with no explicit employeeId filter:
    themselves, plus anyone they participate in as SETTER/REVIEWER — derived
    from Participation, so this is correct even if the directory (above) is
    unpopulated. Admins get None: no default scoping (still filterable by the
    explicit query params), matching HR/admin's need for org-wide visibility.
    This closes a real gap: previously GET /assignments with no employeeId
    returned every employee's assignments to any authenticated caller."""
    if user.role == "admin":
        return None
    owner_ids = {
        row[0] for row in (
            db.query(GoalAssignment.owner_id)
            .join(Participation, Participation.assignment_id == GoalAssignment.id)
            .filter(Participation.employee_id == user.name, GoalAssignment.is_delete == False)  # noqa: E712
            .distinct()
        )
    }
    owner_ids.add(user.name)
    return owner_ids


def _can_view_employee(db: Session, user: CurrentUser, employee_id: str) -> bool:
    if user.role == "admin" or user.name == employee_id:
        return True
    participates = (
        db.query(GoalAssignment.id)
        .join(Participation, Participation.assignment_id == GoalAssignment.id)
        .filter(
            GoalAssignment.owner_id == employee_id, GoalAssignment.is_delete == False,  # noqa: E712
            Participation.employee_id == user.name, Participation.role.in_(["SETTER", "REVIEWER"]),
        )
        .first()
    )
    if participates:
        return True
    emp = db.query(Employee).filter_by(id=employee_id, is_delete=False).first()
    return bool(emp and emp.manager_id == user.name)


def list_assignments(
    db: Session, user: CurrentUser, employee_id=None, status=None, period_id=None,
) -> list[GoalAssignment]:
    q = db.query(GoalAssignment).filter_by(is_delete=False)
    if employee_id:
        if not _can_view_employee(db, user, employee_id):
            raise ApiError(403, FORBIDDEN, "Not permitted to view this employee's assignments")
        q = q.filter_by(owner_id=employee_id)
    else:
        allowed = _authorized_owner_ids(db, user)
        if allowed is not None:
            q = q.filter(GoalAssignment.owner_id.in_(allowed))
    if status:
        q = q.filter_by(assignment_status=status)
    if period_id:
        q = q.filter_by(period_id=period_id)
    return q.order_by(GoalAssignment.create_time).all()


def get_assignment(db: Session, assignment_id: str) -> GoalAssignment:
    a = db.query(GoalAssignment).filter_by(id=assignment_id, is_delete=False).first()
    if not a:
        raise ApiError(404, NOT_FOUND, "Assignment not found")
    return a


def list_audit(db: Session, assignment_id: str) -> list[AuditEntry]:
    return (
        db.query(AuditEntry)
        .filter_by(assignment_id=assignment_id)
        .order_by(AuditEntry.at)
        .all()
    )


def _maybe_activate(a: GoalAssignment) -> None:
    if a.employee_acceptance == "ACCEPTED" and a.manager_acceptance == "ACCEPTED":
        a.assignment_status = "ACTIVE"


def _guard_period_not_locked(db: Session, a: GoalAssignment) -> None:
    """Raise 409 if the assignment's review period is locked. Mutations of a
    goal/assignment (edit, accept, request-change, reject) are blocked once
    the owning period has been locked."""
    if not a.period_id:
        return
    p = db.query(ReviewPeriod).filter_by(id=a.period_id, is_delete=False).first()
    if p is not None and p.locked:
        raise ApiError(409, CONFLICT, "Review period is locked; this assignment cannot be modified")


def _guard_not_completed(a: GoalAssignment) -> None:
    """A goal whose early completion has been approved is frozen: no further
    acceptance edits or change requests."""
    if a.assignment_status in ("COMPLETED", "COMPLETION_REQUESTED"):
        raise ApiError(409, CONFLICT,
                       "Assignment is in early-completion flow; resolve completion first")


def accept(db: Session, assignment_id: str, user: CurrentUser) -> GoalAssignment:
    a = get_assignment(db, assignment_id)
    _guard_period_not_locked(db, a)
    _guard_not_completed(a)
    if user.name == a.owner_id:
        a.employee_acceptance = "ACCEPTED"
        side = "employee"
    elif user.role in SETTER_ROLES:
        a.manager_acceptance = "ACCEPTED"
        side = "manager"
    else:
        raise ApiError(403, FORBIDDEN, "Not permitted to accept this assignment")
    _maybe_activate(a)
    _audit(db, a.id, user.name, "ACCEPTED", f"{side} accepted"
           + (" → ACTIVE" if a.assignment_status == "ACTIVE" else ""))
    db.commit()
    db.refresh(a)
    if a.assignment_status == "ACTIVE":
        for rid in {a.owner_id, a.reviewer_id}:
            internal.emit_event(
                "ASSIGNMENT_ACTIVE", rid,
                "Goal is now active",
                f"'{a.measure}' is active — check-ins can begin.",
                "/goals",
            )
    return a


def request_change(db: Session, assignment_id: str, p: schemas.RequestChange, user: CurrentUser) -> GoalAssignment:
    a = get_assignment(db, assignment_id)
    _guard_period_not_locked(db, a)
    _guard_not_completed(a)
    if user.name != a.owner_id:
        raise ApiError(403, FORBIDDEN, "Only the owner may request a change")
    new_weight = a.weight if p.weight is None else max(0, min(10, p.weight))
    # The owner's section (pillar+cadence) weights must still total 10 after the tweak.
    others = (
        db.query(GoalAssignment)
        .filter_by(owner_id=a.owner_id, fiscal_year=a.fiscal_year, pillar=a.pillar,
                   cadence=a.cadence, is_delete=False)
        .all()
    )
    total = sum((new_weight if o.id == a.id else o.weight) for o in others)
    if total != SECTION_TOTAL:
        raise ApiError(400, PARAM_INVALID,
                       f"Section weights must total {SECTION_TOTAL} (got {total})")
    if p.tweakedCriteria is not None:
        a.criteria = p.tweakedCriteria.strip()
    a.weight = new_weight
    a.assignment_status = "CHANGE_REQUESTED"
    a.manager_acceptance = "PENDING"  # manager must re-accept the change
    _audit(db, a.id, user.name, "EDITED", "Owner requested a change")
    db.commit()
    db.refresh(a)
    return a


def reject(db: Session, assignment_id: str, user: CurrentUser) -> GoalAssignment:
    a = get_assignment(db, assignment_id)
    _guard_period_not_locked(db, a)
    if user.name == a.owner_id:
        a.employee_acceptance = "REJECTED"
    elif user.role in SETTER_ROLES:
        a.manager_acceptance = "REJECTED"
    else:
        raise ApiError(403, FORBIDDEN, "Not permitted to reject this assignment")
    a.assignment_status = "PENDING_ACCEPTANCE"
    _audit(db, a.id, user.name, "REJECTED", "Assignment rejected")
    db.commit()
    db.refresh(a)
    return a


# --------------------------------------------------------------------------
# Early completion: owner requests, manager (reviewer/setter/admin) approves.
# COMPLETED freezes the assignment from further edits; its ratings still
# finalize normally when the review period is locked.
# --------------------------------------------------------------------------

def request_completion(
    db: Session, assignment_id: str, p: schemas.CompletionRequest, user: CurrentUser
) -> GoalAssignment:
    a = get_assignment(db, assignment_id)
    _guard_period_not_locked(db, a)
    if user.name != a.owner_id:
        raise ApiError(403, FORBIDDEN, "Only the goal owner may request early completion")
    if a.assignment_status != "ACTIVE":
        raise ApiError(409, CONFLICT, "Only an ACTIVE goal can be completed early")
    a.assignment_status = "COMPLETION_REQUESTED"
    detail = "Owner requested early completion" + (f": {p.note.strip()}" if p.note.strip() else "")
    _audit(db, a.id, user.name, "COMPLETION_REQUESTED", detail)
    db.commit()
    db.refresh(a)
    # Notify the reviewer that an approval is waiting.
    if a.reviewer_id:
        internal.emit_event(
            "COMPLETION_REQUESTED", a.reviewer_id,
            "Early completion requested",
            f"{a.owner_id} marked '{a.measure}' done early — approve or reject.",
            "/goals",
        )
    return a


def decide_completion(
    db: Session, assignment_id: str, p: schemas.CompletionDecision, user: CurrentUser
) -> GoalAssignment:
    a = get_assignment(db, assignment_id)
    _guard_period_not_locked(db, a)
    if user.role not in SETTER_ROLES and user.name != a.reviewer_id:
        raise ApiError(403, FORBIDDEN, "Only the reviewer/manager may decide early completion")
    if a.assignment_status != "COMPLETION_REQUESTED":
        raise ApiError(409, CONFLICT, "No pending completion request for this assignment")
    decision = (p.decision or "").upper()
    if decision not in ("APPROVE", "REJECT"):
        raise ApiError(400, PARAM_INVALID, "decision must be APPROVE or REJECT")
    note = (p.note or "").strip()

    if decision == "APPROVE":
        a.assignment_status = "COMPLETED"
        _audit(db, a.id, user.name, "COMPLETED",
               f"Early completion approved by {user.name}" + (f": {note}" if note else ""))
        event, title, body = ("COMPLETION_APPROVED", "Goal marked complete",
                              f"'{a.measure}' was approved as complete by {user.name}.")
    else:
        a.assignment_status = "ACTIVE"
        _audit(db, a.id, user.name, "COMPLETION_REJECTED",
               f"Early completion rejected by {user.name}" + (f": {note}" if note else ""))
        event, title, body = ("COMPLETION_REJECTED", "Early completion rejected",
                              f"Your completion request for '{a.measure}' was rejected.")
    db.commit()
    db.refresh(a)
    internal.emit_event(event, a.owner_id, title, body, "/goals")
    return a


def goal_out(g: Goal) -> dict:
    return {
        "id": g.id, "fiscalYear": g.fiscal_year, "pillar": g.pillar, "cadence": g.cadence,
        "goalType": g.goal_type, "measure": g.measure, "description": g.description,
        "baseCriteria": g.base_criteria, "defaultWeight": g.default_weight,
        "competencies": g.competencies, "status": g.goal_status, "setterId": g.setter_id,
    }


def assignment_out(a: GoalAssignment) -> dict:
    return {
        "id": a.id, "goalId": a.goal_id, "fiscalYear": a.fiscal_year, "periodId": a.period_id,
        "ownerId": a.owner_id,
        "setterId": a.setter_id, "reviewerId": a.reviewer_id, "pillar": a.pillar,
        "cadence": a.cadence, "goalType": a.goal_type, "measure": a.measure,
        "criteria": a.criteria, "weight": a.weight, "competencies": a.competencies,
        "status": a.assignment_status, "employeeAcceptance": a.employee_acceptance,
        "managerAcceptance": a.manager_acceptance, "partialYear": a.partial_year,
        "isActive": a.assignment_status == "ACTIVE",
    }


def audit_out(e: AuditEntry) -> dict:
    return {
        "id": e.id, "assignmentId": e.assignment_id, "actor": e.actor,
        "action": e.action, "detail": e.detail, "at": e.at.isoformat() + "Z",
    }


# --------------------------------------------------------------------------
# Period lock + cross-service reads (called by pm-eval / pm-score).
# --------------------------------------------------------------------------

def get_period(db: Session, period_id: str) -> ReviewPeriod:
    p = db.query(ReviewPeriod).filter_by(id=period_id, is_delete=False).first()
    if not p:
        raise ApiError(404, NOT_FOUND, "Review period not found")
    return p


def lock_period(db: Session, period_id: str, user: CurrentUser) -> dict:
    """Lock a period: freeze its ACTIVE assignments, then tell pm-eval to
    finalize their evaluations and notify the owners."""
    if user.role != "admin":
        raise ApiError(403, FORBIDDEN, "lock_period privilege required")
    p = get_period(db, period_id)
    if p.locked:
        raise ApiError(409, CONFLICT, "Period already locked")
    p.locked = True

    assignments = (
        db.query(GoalAssignment)
        .filter_by(fiscal_year=p.fiscal_year, cadence=p.cadence, is_delete=False)
        .all()
    )
    locked_ids: list[str] = []
    finalize_ids: list[str] = []
    owners: set[str] = set()
    for a in assignments:
        if a.assignment_status == "ACTIVE":
            a.assignment_status = "LOCKED"
            _audit(db, a.id, user.name, "LOCKED", f"Period {p.code} locked")
            locked_ids.append(a.id)
            finalize_ids.append(a.id)
            owners.add(a.owner_id)
        elif a.assignment_status == "COMPLETED":
            # Already-completed goals keep their COMPLETED status but their
            # ratings still finalize with the rest of the period.
            finalize_ids.append(a.id)
            owners.add(a.owner_id)
    db.commit()

    # Tell pm-eval to finalize the latest evaluations for these assignments.
    internal.post_json(
        "eval", f"/api/pm-eval/system/periods/{period_id}/finalize",
        {"assignmentIds": finalize_ids, "periodCode": p.code},
    )
    # Notify owners their period is locked.
    for owner in owners:
        internal.emit_event(
            "PERIOD_LOCKED", owner,
            f"{p.label} locked",
            f"{p.label} ({p.window}) has been locked. Ratings are now final.",
            "/scorecard",
        )
    return {
        "periodId": p.id, "code": p.code, "locked": True,
        "lockedAssignments": len(locked_ids),
    }


def assignments_for(db: Session, employee_id: str, fiscal_year: str) -> list[dict]:
    """Assignment pillar + weight for an employee/year — used by pm-score to
    build IPF sections. Includes periodId/periodCode (e.g. "Q1") so pm-score
    can bucket QUARTERLY assignments by their actual period instead of
    guessing from encounter order."""
    rows = (
        db.query(GoalAssignment)
        .filter_by(owner_id=employee_id, fiscal_year=fiscal_year, is_delete=False)
        .all()
    )
    period_ids = {a.period_id for a in rows if a.period_id}
    period_code_by_id = {
        p.id: p.code
        for p in db.query(ReviewPeriod).filter(ReviewPeriod.id.in_(period_ids)).all()
    } if period_ids else {}
    return [
        {"assignmentId": a.id, "pillar": a.pillar, "weight": a.weight,
         "cadence": a.cadence, "status": a.assignment_status,
         "periodId": a.period_id or None,
         "periodCode": period_code_by_id.get(a.period_id)}
        for a in rows
    ]


# --------------------------------------------------------------------------
# Review period unlock approval chain.
# --------------------------------------------------------------------------

UNLOCK_REQUESTER_ROLES = ("manager", "admin")


def unlock_request_out(r: UnlockRequest) -> dict:
    return {
        "id": r.id, "periodId": r.period_id, "requestedBy": r.requested_by,
        "reason": r.reason, "status": r.status, "decidedBy": r.decided_by,
        "decisionReason": r.decision_reason,
        "decidedAt": (r.decided_at.isoformat() + "Z") if r.decided_at else None,
    }


def list_unlock_requests(db: Session, period_id: str, status: str | None = None) -> list[UnlockRequest]:
    q = db.query(UnlockRequest).filter_by(period_id=period_id, is_delete=False)
    if status:
        q = q.filter_by(status=status.upper())
    return q.order_by(UnlockRequest.create_time.desc()).all()


def get_unlock_request(db: Session, period_id: str, req_id: str) -> UnlockRequest:
    r = (
        db.query(UnlockRequest)
        .filter_by(id=req_id, period_id=period_id, is_delete=False)
        .first()
    )
    if not r:
        raise ApiError(404, NOT_FOUND, "Unlock request not found")
    return r


def request_unlock(
    db: Session, period_id: str, p: schemas.UnlockRequestCreate, user: CurrentUser
) -> UnlockRequest:
    if user.role not in UNLOCK_REQUESTER_ROLES:
        raise ApiError(403, FORBIDDEN, "unlock_request privilege required")
    period = get_period(db, period_id)
    if not period.locked:
        raise ApiError(409, CONFLICT, "Period is not locked")

    req = UnlockRequest(
        period_id=period_id, requested_by=user.name, reason=p.reason,
        status="PENDING", create_user=user.name,
    )
    db.add(req)
    db.flush()
    # Record on the audit trail of every assignment in the period so the
    # unlock request is visible alongside the assignment's own history.
    affected = (
        db.query(GoalAssignment)
        .filter_by(fiscal_year=period.fiscal_year, cadence=period.cadence, is_delete=False)
        .all()
    )
    for a in affected:
        _audit(db, a.id, user.name, "UNLOCK_REQUESTED",
               f"Unlock requested for {period.code}: {p.reason}")
    db.commit()
    db.refresh(req)

    internal.emit_event(
        "UNLOCK_REQUESTED", "admin",
        f"Unlock requested for {period.label}",
        f"{user.name} requested to unlock {period.label} ({period.window}): {p.reason}",
        "/periods",
    )
    return req


def decide_unlock(
    db: Session, period_id: str, req_id: str, p: schemas.UnlockDecision, user: CurrentUser
) -> UnlockRequest:
    if user.role != "admin":
        raise ApiError(403, FORBIDDEN, "unlock_decision privilege required")
    decision = (p.decision or "").upper()
    if decision not in ("APPROVE", "REJECT"):
        raise ApiError(400, PARAM_INVALID, "decision must be APPROVE or REJECT")

    period = get_period(db, period_id)
    req = get_unlock_request(db, period_id, req_id)
    if req.status != "PENDING":
        raise ApiError(409, CONFLICT, "Unlock request already decided")

    req.decided_by = user.name
    req.decision_reason = p.reason or ""
    req.decided_at = _utcnow()
    req.update_user = user.name

    affected = (
        db.query(GoalAssignment)
        .filter_by(fiscal_year=period.fiscal_year, cadence=period.cadence, is_delete=False)
        .all()
    )

    if decision == "APPROVE":
        req.status = "APPROVED"
        period.locked = False
        for a in affected:
            # Symmetric with lock_period (ACTIVE -> LOCKED): restore locked
            # assignments to ACTIVE so corrected ratings can actually be
            # submitted — pm-eval's pre-check requires ACTIVE status.
            if a.assignment_status == "LOCKED":
                a.assignment_status = "ACTIVE"
            _audit(db, a.id, user.name, "UNLOCKED",
                   f"Unlock approved by {user.name} (requested by {req.requested_by}): {req.decision_reason}")
    else:
        req.status = "REJECTED"
        for a in affected:
            _audit(db, a.id, user.name, "UNLOCK_REQUESTED",
                   f"Unlock rejected by {user.name} (requested by {req.requested_by}): {req.decision_reason}")

    db.commit()
    db.refresh(req)

    if decision == "APPROVE":
        # Best-effort: ask pm-eval to reopen evaluations for this period.
        internal.post_json(
            "eval", f"/api/pm-eval/system/periods/{period_id}/reopen",
            {"periodCode": period.code},
        )

    internal.emit_event(
        "UNLOCK_DECISION", req.requested_by,
        f"Unlock request {req.status.lower()}",
        f"Your unlock request for {period.label} was {req.status.lower()}"
        + (f": {req.decision_reason}" if req.decision_reason else ""),
        "/periods",
    )
    return req


# --------------------------------------------------------------------------
# Cross-service contracts: pm-eval RATED event, pm-eval status check,
# pm-score ACKNOWLEDGED update.
# --------------------------------------------------------------------------

def record_rated(db: Session, assignment_id: str, p: schemas.RatedEvent) -> None:
    a = get_assignment(db, assignment_id)
    _audit(db, a.id, p.ratedBy, "RATED", f"{p.source} rating recorded at {p.evaluatedAt}")
    db.commit()


def system_assignment_status(db: Session, assignment_id: str) -> dict:
    a = get_assignment(db, assignment_id)
    period_locked = False
    if a.period_id:
        period = db.query(ReviewPeriod).filter_by(id=a.period_id, is_delete=False).first()
        if period is not None:
            period_locked = period.locked
    reviewer_ids = [
        row.employee_id for row in (
            db.query(Participation)
            .filter_by(assignment_id=a.id, role="REVIEWER")
            .all()
        )
    ]
    if not reviewer_ids and a.reviewer_id:
        reviewer_ids = [a.reviewer_id]
    return {
        "id": a.id, "status": a.assignment_status, "ownerId": a.owner_id,
        "reviewerIds": reviewer_ids, "periodId": a.period_id, "periodLocked": period_locked,
    }


def acknowledge_assignments(db: Session, p: schemas.AcknowledgeRequest) -> dict:
    """fiscalYear arrives as an int per the pm-score contract, but this
    service stores fiscal_year as an opaque code string (e.g. "FY26-27").
    Match on an exact string cast first; fall back to a substring match
    against the numeric year so either convention resolves correctly."""
    year_str = str(p.fiscalYear)
    rows = (
        db.query(GoalAssignment)
        .filter_by(owner_id=p.employeeId, is_delete=False)
        .filter(GoalAssignment.assignment_status.in_(["ACTIVE", "LOCKED"]))
        .filter(
            (GoalAssignment.fiscal_year == year_str)
            | (GoalAssignment.fiscal_year.contains(year_str))
        )
        .all()
    )
    updated = 0
    for a in rows:
        a.assignment_status = "ACKNOWLEDGED"
        _audit(db, a.id, p.employeeId, "ACKNOWLEDGED", f"Acknowledged by {p.employeeId}")
        updated += 1
    db.commit()
    return {"updatedCount": updated}


# --------------------------------------------------------------------------
# Mid-cycle reassignment, joiners, and leavers.
# --------------------------------------------------------------------------

def _transfer_reviewer(db: Session, a: GoalAssignment, new_manager_id: str, actor: str) -> None:
    old_manager = a.reviewer_id
    db.query(Participation).filter_by(assignment_id=a.id, role="REVIEWER").delete()
    db.add(Participation(assignment_id=a.id, employee_id=new_manager_id, role="REVIEWER"))
    a.reviewer_id = new_manager_id
    a.setter_id = new_manager_id
    _audit(db, a.id, actor, "REASSIGNED",
           f"Reviewer reassigned from {old_manager or '(none)'} to {new_manager_id}")


def reassign_assignment(
    db: Session, assignment_id: str, p: schemas.ReassignRequest, user: CurrentUser
) -> GoalAssignment:
    if user.role not in SETTER_ROLES:
        raise ApiError(403, FORBIDDEN, "reassign privilege required")
    a = get_assignment(db, assignment_id)
    new_manager_id = (p.newManagerId or "").strip()
    if not new_manager_id:
        raise ApiError(400, PARAM_INVALID, "newManagerId is required")
    if new_manager_id == a.owner_id:
        raise ApiError(409, CONFLICT, "Owner cannot be reviewer on the same assignment")
    _transfer_reviewer(db, a, new_manager_id, user.name)
    db.commit()
    db.refresh(a)
    return a


def _employee_assignments(db: Session, employee_id: str, fiscal_year: str) -> list[GoalAssignment]:
    return (
        db.query(GoalAssignment)
        .filter_by(owner_id=employee_id, fiscal_year=fiscal_year, is_delete=False)
        .all()
    )


def _periods_from(db: Session, fiscal_year: str, from_period_id: str | None) -> list[ReviewPeriod]:
    """Periods at/after the given period (ordered by code) for a fiscal year.
    If from_period_id is falsy, returns all periods for the year."""
    periods = list_periods(db, fiscal_year)
    if not from_period_id:
        return periods
    codes = [p.code for p in periods]
    start = next((i for i, p in enumerate(periods) if p.id == from_period_id), None)
    if start is None:
        return periods
    return periods[start:]


def lifecycle_event(
    db: Session, employee_id: str, p: schemas.LifecycleRequest, user: CurrentUser
) -> dict:
    if user.role not in SETTER_ROLES:
        raise ApiError(403, FORBIDDEN, "lifecycle privilege required")
    event_type = (p.eventType or "").upper()
    if event_type not in ("JOINER", "LEAVER", "REASSIGNMENT"):
        raise ApiError(400, PARAM_INVALID, "eventType must be JOINER, LEAVER, or REASSIGNMENT")

    affected: list[GoalAssignment] = []

    if event_type == "JOINER":
        goal_ids = p.goalIds or []
        periods = _periods_from(db, p.fiscalYear, p.effectiveFromPeriodId)
        period_ids = {pr.id for pr in periods}
        if goal_ids:
            goals = db.query(Goal).filter(Goal.id.in_(goal_ids), Goal.is_delete == False).all()  # noqa: E712
        else:
            # No explicit goalIds: cascade every already-cascaded goal for this
            # fiscal year (goals cascaded to peers).
            goals = (
                db.query(Goal)
                .filter_by(fiscal_year=p.fiscalYear, goal_status="CASCADED", is_delete=False)
                .all()
            )
        for g in goals:
            period = _resolve_period(db, g.fiscal_year, g.cadence)
            if period is not None and period.id not in period_ids and p.effectiveFromPeriodId:
                # Goal's natural period predates the joiner's effective period; skip.
                continue
            a = GoalAssignment(
                goal_id=g.id, fiscal_year=g.fiscal_year, period_id=period.id if period else "",
                owner_id=employee_id, setter_id=user.name, reviewer_id=user.name,
                pillar=g.pillar, cadence=g.cadence, goal_type=g.goal_type,
                measure=g.measure, criteria=g.base_criteria, weight=g.default_weight,
                competencies=g.competencies, assignment_status="PENDING_ACCEPTANCE",
                employee_acceptance="PENDING", manager_acceptance="PENDING",
                partial_year=True, create_user=user.name,
            )
            db.add(a)
            db.flush()
            db.add(Participation(assignment_id=a.id, employee_id=employee_id, role="OWNER"))
            db.add(Participation(assignment_id=a.id, employee_id=user.name, role="SETTER"))
            db.add(Participation(assignment_id=a.id, employee_id=user.name, role="REVIEWER"))
            _audit(db, a.id, user.name, "JOINER",
                   f"Joiner cascade: '{g.measure}' assigned to {employee_id} (partial year)")
            affected.append(a)

    elif event_type == "LEAVER":
        periods = _periods_from(db, p.fiscalYear, p.effectiveFromPeriodId)
        period_ids = {pr.id for pr in periods}
        rows = _employee_assignments(db, employee_id, p.fiscalYear)
        for a in rows:
            a.partial_year = True
            if a.assignment_status in ("ACTIVE", "PENDING_ACCEPTANCE") and (
                not p.effectiveFromPeriodId or a.period_id in period_ids
            ):
                a.assignment_status = "CLOSED"
                _audit(db, a.id, user.name, "LEAVER",
                       f"Closed on leaver event for {employee_id}")
                affected.append(a)
            else:
                # Earlier periods retained untouched for scoring, but still
                # flagged partial_year and recorded on the trail.
                _audit(db, a.id, user.name, "LEAVER",
                       f"Retained (already participated) for {employee_id}")

    else:  # REASSIGNMENT
        new_manager_id = (p.newManagerId or "").strip()
        if not new_manager_id:
            raise ApiError(400, PARAM_INVALID, "newManagerId is required for REASSIGNMENT")
        rows = _employee_assignments(db, employee_id, p.fiscalYear)
        for a in rows:
            if a.assignment_status in ("ACTIVE", "PENDING_ACCEPTANCE", "CHANGE_REQUESTED"):
                _transfer_reviewer(db, a, new_manager_id, user.name)
                affected.append(a)

    db.commit()
    for a in affected:
        db.refresh(a)
    return {
        "eventType": event_type,
        "employeeId": employee_id,
        "affectedAssignmentIds": [a.id for a in affected],
        "assignments": [assignment_out(a) for a in affected],
    }


# --------------------------------------------------------------------------
# Tenant onboarding (schema + seed only — no external Tenant Manager calls).
# --------------------------------------------------------------------------

def onboard_tenant(db: Session) -> dict:
    """Idempotently ensure this service's schema exists and seed the demo
    employee directory (UAM stub — see models.Employee). Pillars/cadences
    are Python enums, not DB rows, so there's no other reference data to seed."""
    from ..common.db import Base, init

    init()  # ensure_database + create_all (idempotent)
    seeded = seed_directory_if_empty(db)
    tables = sorted(Base.metadata.tables.keys())
    return {"status": "COMPLETED", "tablesEnsured": tables, "directorySeeded": seeded}


def onboarding_query(db: Session) -> dict:
    return {"status": "COMPLETED"}
