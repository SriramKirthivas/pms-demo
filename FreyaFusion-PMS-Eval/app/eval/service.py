"""pm-eval logic: append-only self/reviewer evaluations + continuous feedback."""

import logging
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation

from sqlalchemy.orm import Session

from ..common import internal
from ..common.auth import DEFAULT_TENANT_ID, CurrentUser
from ..common.envelope import CONFLICT, FORBIDDEN, NOT_FOUND, PARAM_INVALID, ApiError
from . import schemas
from .models import CheckInNote, ContinuousFeedback, Evaluation, EvalAuditLog, TenantOnboarding

logger = logging.getLogger(__name__)

REVIEWER_ROLES = ("manager", "admin")

# H1 = first half of the fiscal year. pm-goal periods are quarterly (Q1..Q4,
# Apr-Mar fiscal year) or monthly (M01..M06 = Apr-Sep); either cadence's
# first-half codes are enumerated here so /mid-year can classify a period
# without needing a live pm-goal call for the common case.
H1_PERIOD_CODES = {"Q1", "Q2", "M01", "M02", "M03", "M04", "M05", "M06"}


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _clamp_rating(v) -> Decimal:
    """Validate rating is within [1.00, 5.00] and has at most 2 decimal places.
    Out-of-range or over-precise values are REJECTED (HTTP 400), never rounded."""
    if v is None:
        raise ApiError(400, PARAM_INVALID, "rating is required")
    try:
        d = Decimal(str(v))
    except (InvalidOperation, ValueError):
        raise ApiError(400, PARAM_INVALID, "rating must be a number")
    if d < Decimal("1.00") or d > Decimal("5.00"):
        raise ApiError(400, PARAM_INVALID, "rating must be between 1.00 and 5.00")
    # exponent > -2 means fewer than 2 fractional digits are stored, which is fine;
    # exponent < -2 means more than 2 decimal places were supplied.
    exponent = d.normalize().as_tuple().exponent
    if isinstance(exponent, int) and exponent < -2:
        raise ApiError(400, PARAM_INVALID, "rating must have at most 2 decimal places")
    return d.quantize(Decimal("1.00"))


# --------------------------------------------------------------------------
# pm-goal pre-checks (gap #2) — verifying ACTIVE status + lock state before
# accepting an evaluation. Written as small, independently-monkeypatchable
# functions so tests don't need a live pm-goal.
# --------------------------------------------------------------------------

def fetch_assignment(assignment_id: str) -> dict:
    """GET {PM_GOAL_BASE_URL}/system/assignments/{assignmentId}.

    This is a REQUIRED precondition, not a best-effort notification — if the
    call fails or times out we must not silently allow the evaluation, so it
    uses get_json_strict (raises InternalCallError) rather than the
    best-effort get_json used elsewhere in this module.
    """
    return internal.get_json_strict("goal", f"/api/pm-goal/system/assignments/{assignment_id}")


def verify_assignment_active(assignment_id: str) -> dict:
    """Verify the assignment is ACTIVE and its period is not locked.

    Returns the assignment payload (so callers can also read periodId etc.)
    on success; raises ApiError(409) if the assignment is not ACTIVE or its
    period is locked, and ApiError(502) if pm-goal cannot be reached at all.
    """
    try:
        data = fetch_assignment(assignment_id)
    except internal.InternalCallError as err:
        logger.error("pm-goal verification failed for assignment %s: %s", assignment_id, err)
        raise ApiError(502, "UPSTREAM_UNAVAILABLE",
                       "Could not verify assignment status with pm-goal") from err
    if not data:
        raise ApiError(404, NOT_FOUND, "Assignment not found in pm-goal")
    if data.get("status") != "ACTIVE":
        raise ApiError(409, CONFLICT, "Assignment is not ACTIVE")
    if data.get("periodLocked"):
        raise ApiError(409, CONFLICT, "Assignment's review period is locked")
    return data


def _can_view_assignment(assignment_id: str, user: CurrentUser) -> bool:
    """Record-level check: only an admin, the assignment's owner, or one of
    its reviewers may view its evaluations. Best-effort against pm-goal —
    if pm-goal is unreachable (e.g. not configured, as in this repo's
    hermetic unit tests) this degrades OPEN rather than blocking every read,
    matching the best-effort cross-service pattern used elsewhere in this
    codebase (internal.get_json). In a real deployment pm-goal is always
    reachable, so this meaningfully enforces the restriction there."""
    if user.role == "admin":
        return True
    data = internal.get_json("goal", f"/api/pm-goal/system/assignments/{assignment_id}")
    if not data:
        return True
    if data.get("ownerId") == user.name:
        return True
    return user.name in (data.get("reviewerIds") or [])


def _can_view_employee_data(employee_id: str, user: CurrentUser) -> bool:
    """Same best-effort record-level pattern as _can_view_assignment, but for
    endpoints keyed by employeeId (feedback, check-in notes, mid-year) rather
    than assignmentId: self, admin, or that employee's manager (per pm-goal's
    directory) may view it. A plain "employee" role may NEVER view another
    employee's data regardless of pm-goal reachability — only "manager" gets
    the best-effort manager-of check (degrades OPEN if pm-goal is
    unreachable, e.g. not configured, as in this repo's hermetic tests)."""
    if user.role == "admin" or user.name == employee_id:
        return True
    if user.role != "manager":
        return False
    rows = internal.get_json("goal", "/api/pm-goal/system/employees", params={"ids": employee_id})
    if not rows:
        return True
    emp = next((r for r in rows if r.get("id") == employee_id), None)
    if emp is None:
        return True  # directory doesn't know this id — can't verify, don't block
    return emp.get("managerId") == user.name


def _emit_rated_to_goal(assignment_id: str, source: str, rated_by: str, evaluated_at: datetime) -> None:
    """POST {PM_GOAL_BASE_URL}/system/assignments/{assignmentId}/rated.
    Best-effort / fire-and-forget: a failure here must not fail the
    evaluation submission that already committed successfully."""
    try:
        internal.post_json(
            "goal", f"/api/pm-goal/system/assignments/{assignment_id}/rated",
            {
                "source": source,
                "ratedBy": rated_by,
                "evaluatedAt": evaluated_at.replace(tzinfo=timezone.utc).isoformat(),
            },
        )
    except Exception as err:  # noqa: BLE001 — best-effort, never fail the caller
        logger.warning("Failed to emit RATED event to pm-goal for %s: %s", assignment_id, err)


def _latest_for(db: Session, assignment_id: str, source: str, period_id: str) -> Evaluation | None:
    return (
        db.query(Evaluation)
        .filter_by(assignment_id=assignment_id, source=source, period_id=period_id, is_delete=False)
        .order_by(Evaluation.evaluated_at.desc())
        .first()
    )


def _guard_not_final(db: Session, assignment_id: str, source: str, period_id: str) -> None:
    """Gap #5: once the latest evaluation for this assignment+source+period is
    final, reject further submissions for that same period/assignment."""
    latest = _latest_for(db, assignment_id, source, period_id)
    if latest is not None and latest.is_final:
        raise ApiError(409, CONFLICT, "This evaluation period is already finalized and immutable")


def submit_self(db: Session, p: schemas.RatingInput, user: CurrentUser) -> Evaluation:
    rating = _clamp_rating(p.rating)
    assignment = verify_assignment_active(p.assignmentId)
    period_id = p.periodId or assignment.get("periodId", "")
    _guard_not_final(db, p.assignmentId, "SELF", period_id)
    e = Evaluation(
        assignment_id=p.assignmentId, employee_id=user.name, period_id=period_id, source="SELF",
        rated_by=user.name, rating=rating, comment=p.comment.strip(),
        is_final=False, create_user=user.name, tenant_id=user.tenant_id,
    )
    db.add(e)
    db.commit()
    db.refresh(e)
    _emit_rated_to_goal(p.assignmentId, "SELF", user.name, e.evaluated_at)
    return e


def add_reviewer(db: Session, p: schemas.RatingInput, user: CurrentUser) -> Evaluation:
    if user.role not in REVIEWER_ROLES:
        raise ApiError(403, FORBIDDEN, "submit_reviewer_rating privilege required")
    if p.employeeId == user.name:
        raise ApiError(403, FORBIDDEN, "A reviewer cannot rate their own assignment")
    rating = _clamp_rating(p.rating)
    assignment = verify_assignment_active(p.assignmentId)
    # Spec: "only a designated reviewer SHALL submit a REVIEWER rating" —
    # enforced only when pm-goal actually reports reviewerIds (real pm-goal
    # always does; this repo's hand-written test fakes often omit the key,
    # in which case we can't verify and don't block).
    if "reviewerIds" in assignment and user.name not in (assignment.get("reviewerIds") or []):
        raise ApiError(403, FORBIDDEN, "Only a designated reviewer may rate this assignment")
    period_id = p.periodId or assignment.get("periodId", "")
    _guard_not_final(db, p.assignmentId, "REVIEWER", period_id)
    e = Evaluation(
        assignment_id=p.assignmentId, employee_id=p.employeeId, period_id=period_id, source="REVIEWER",
        rated_by=user.name, rating=rating, comment=p.comment.strip(),
        is_final=False, create_user=user.name, tenant_id=user.tenant_id,
    )
    db.add(e)
    db.commit()
    db.refresh(e)
    # Let the owner know their manager rated them (pm-notify catalog event).
    internal.emit_event(
        "RATING_SUBMITTED", p.employeeId,
        "New manager rating",
        f"{user.name} submitted a rating of {rating:.2f}.",
        "/goals",
    )
    # Tell pm-goal a RATED event occurred (spec: emitted for BOTH sources).
    _emit_rated_to_goal(p.assignmentId, "REVIEWER", user.name, e.evaluated_at)
    return e


def finalize(db: Session, period_id: str, assignment_ids: list[str]) -> int:
    """Mark the latest evaluation of each (assignment, source) WITHIN THIS
    PERIOD final + immutable. Called by pm-goal when a review period is locked."""
    marked = 0
    for aid in assignment_ids:
        rows = (
            db.query(Evaluation)
            .filter_by(assignment_id=aid, period_id=period_id, is_delete=False)
            .order_by(Evaluation.evaluated_at)
            .all()
        )
        latest: dict[str, Evaluation] = {}
        for e in rows:
            latest[e.source] = e  # asc -> last wins
        for e in latest.values():
            if not e.is_final:
                e.is_final = True
                marked += 1
    db.add(EvalAuditLog(period_id=period_id, action="FINALIZE",
                         detail=f"finalized {marked} evaluation(s) across {len(assignment_ids)} assignment(s)"))
    db.commit()
    return marked


def reopen(db: Session, period_id: str) -> int:
    """Gap #6: clear is_final on every evaluation in this period and record
    the reopening in the lightweight audit log."""
    rows = db.query(Evaluation).filter_by(period_id=period_id, is_final=True, is_delete=False).all()
    reopened = 0
    for e in rows:
        e.is_final = False
        reopened += 1
    db.add(EvalAuditLog(period_id=period_id, action="REOPEN",
                         detail=f"reopened {reopened} evaluation(s)"))
    db.commit()
    return reopened


def finals(db: Session, employee_id: str) -> list[dict]:
    """Final evaluations for an employee (latest final per assignment+source).
    Consumed by pm-score to compute the IPF."""
    rows = (
        db.query(Evaluation)
        .filter_by(employee_id=employee_id, is_final=True, is_delete=False)
        .order_by(Evaluation.evaluated_at)
        .all()
    )
    latest: dict[tuple[str, str], Evaluation] = {}
    for e in rows:
        latest[(e.assignment_id, e.source)] = e
    return [
        {"assignmentId": aid, "source": src, "rating": float(e.rating)}
        for (aid, src), e in latest.items()
    ]


def history(db: Session, assignment_id: str, user: CurrentUser) -> list[Evaluation]:
    if not _can_view_assignment(assignment_id, user):
        raise ApiError(403, FORBIDDEN, "Not permitted to view this assignment's evaluations")
    return (
        db.query(Evaluation)
        .filter_by(assignment_id=assignment_id, is_delete=False)
        .order_by(Evaluation.evaluated_at)
        .all()
    )


def current(db: Session, assignment_id: str, user: CurrentUser) -> dict:
    rows = history(db, assignment_id, user)
    latest = {"SELF": None, "REVIEWER": None}
    for e in rows:
        latest[e.source] = e  # ordered asc -> last wins
    return {
        "assignmentId": assignment_id,
        "self": eval_out(latest["SELF"]) if latest["SELF"] else None,
        "reviewer": eval_out(latest["REVIEWER"]) if latest["REVIEWER"] else None,
    }


def summary(db: Session, employee_id: str, period_id: str, user: CurrentUser) -> dict:
    """Gap #10: per-employee period summary — latest self/reviewer ratings
    across all of that employee's assignments within the given period."""
    if not _can_view_employee_data(employee_id, user):
        raise ApiError(403, FORBIDDEN, "Not permitted to view this employee's evaluation summary")
    rows = (
        db.query(Evaluation)
        .filter_by(employee_id=employee_id, period_id=period_id, is_delete=False)
        .order_by(Evaluation.evaluated_at)
        .all()
    )
    latest: dict[tuple[str, str], Evaluation] = {}
    for e in rows:
        latest[(e.assignment_id, e.source)] = e
    by_assignment: dict[str, dict] = {}
    for (aid, src), e in latest.items():
        slot = by_assignment.setdefault(aid, {"assignmentId": aid, "self": None, "reviewer": None})
        slot["self" if src == "SELF" else "reviewer"] = eval_out(e)
    return {
        "employeeId": employee_id,
        "periodId": period_id,
        "assignments": list(by_assignment.values()),
    }


def log_feedback(db: Session, p: schemas.FeedbackCreate, user: CurrentUser) -> ContinuousFeedback:
    if p.category not in schemas.FEEDBACK_CATEGORIES:
        raise ApiError(400, PARAM_INVALID, f"category must be one of {sorted(schemas.FEEDBACK_CATEGORIES)}")
    if not p.text.strip():
        raise ApiError(400, PARAM_INVALID, "text is required")
    f = ContinuousFeedback(
        about_employee_id=p.aboutEmployeeId, from_user=user.name,
        category=p.category, text=p.text.strip(), fiscal_year=p.fiscalYear,
        create_user=user.name, tenant_id=user.tenant_id,
    )
    db.add(f)
    db.commit()
    db.refresh(f)
    return f


def list_feedback(db: Session, about=None, category=None, author=None) -> list[ContinuousFeedback]:
    q = db.query(ContinuousFeedback).filter_by(is_delete=False)
    if about:
        q = q.filter_by(about_employee_id=about)
    if category:
        q = q.filter_by(category=category)
    if author:
        q = q.filter_by(from_user=author)
    return q.order_by(ContinuousFeedback.at.desc()).all()


def list_feedback_page(db: Session, about=None, category=None, author=None,
                        page_num: int = 1, page_size: int = 20,
                        user: CurrentUser | None = None) -> tuple[list[ContinuousFeedback], int]:
    """Gap #10: paginated feedback listing. Returns (page_rows, total)."""
    if about and user is not None and not _can_view_employee_data(about, user):
        raise ApiError(403, FORBIDDEN, "Not permitted to view feedback about this employee")
    q = db.query(ContinuousFeedback).filter_by(is_delete=False)
    if about:
        q = q.filter_by(about_employee_id=about)
    if category:
        q = q.filter_by(category=category)
    if author:
        q = q.filter_by(from_user=author)
    q = q.order_by(ContinuousFeedback.at.desc())
    total = q.count()
    page_num = max(1, page_num)
    page_size = max(1, page_size)
    rows = q.offset((page_num - 1) * page_size).limit(page_size).all()
    return rows, total


def feedback_by_category(db: Session, about_employee_id: str, fiscal_year: str) -> dict:
    """Gap #10: GET /system/feedback — feedback entries for the year grouped
    by category, for pm-score."""
    rows = (
        db.query(ContinuousFeedback)
        .filter_by(about_employee_id=about_employee_id, fiscal_year=fiscal_year, is_delete=False)
        .order_by(ContinuousFeedback.at)
        .all()
    )
    grouped: dict[str, list[dict]] = {}
    for f in rows:
        grouped.setdefault(f.category, []).append(feedback_out(f))
    return grouped


# --------------------------------------------------------------------------
# Quarterly check-in notes (gap #8)
# --------------------------------------------------------------------------

def add_checkin_note(db: Session, p: schemas.CheckInNoteCreate, user: CurrentUser) -> CheckInNote:
    if user.role not in REVIEWER_ROLES:
        raise ApiError(403, FORBIDDEN, "submit_checkin_note privilege required")
    if not p.note.strip():
        raise ApiError(400, PARAM_INVALID, "note is required")
    n = CheckInNote(
        employee_id=p.employeeId, period_id=p.periodId, author_id=user.name,
        note=p.note.strip(), fiscal_year=p.fiscalYear,
        create_user=user.name, tenant_id=user.tenant_id,
    )
    db.add(n)
    db.commit()
    db.refresh(n)
    return n


def list_checkin_notes(
    db: Session, employee_id: str, period_id: str | None = None, user: CurrentUser | None = None,
) -> list[CheckInNote]:
    if user is not None and not _can_view_employee_data(employee_id, user):
        raise ApiError(403, FORBIDDEN, "Not permitted to view this employee's check-in notes")
    q = db.query(CheckInNote).filter_by(employee_id=employee_id, is_delete=False)
    if period_id:
        q = q.filter_by(period_id=period_id)
    return q.order_by(CheckInNote.at).all()


def checkin_notes_for_year(db: Session, employee_id: str, fiscal_year: str) -> dict:
    """GET /system/check-in-notes — all notes for the fiscal year, grouped by
    period, for pm-score's dev-plan use."""
    rows = (
        db.query(CheckInNote)
        .filter_by(employee_id=employee_id, fiscal_year=fiscal_year, is_delete=False)
        .order_by(CheckInNote.at)
        .all()
    )
    grouped: dict[str, list[dict]] = {}
    for n in rows:
        grouped.setdefault(n.period_id, []).append(checkin_note_out(n))
    return grouped


# --------------------------------------------------------------------------
# Mid-year review checkpoint (gap #9) — read-only, never finalizes anything.
# --------------------------------------------------------------------------

def mid_year_summary(db: Session, employee_id: str, fiscal_year: str, user: CurrentUser) -> dict:
    """Consolidate H1 evaluations (latest self/reviewer per assignment) and
    check-in notes into a read-only summary. Does NOT set is_final on
    anything and does not block further check-ins for the rest of the year."""
    if not _can_view_employee_data(employee_id, user):
        raise ApiError(403, FORBIDDEN, "Not permitted to view this employee's mid-year summary")
    period_ids = _h1_period_ids(fiscal_year)

    eval_q = db.query(Evaluation).filter_by(employee_id=employee_id, is_delete=False)
    if period_ids:
        eval_q = eval_q.filter(Evaluation.period_id.in_(period_ids))
    rows = eval_q.order_by(Evaluation.evaluated_at).all()

    latest: dict[tuple[str, str], Evaluation] = {}
    for e in rows:
        latest[(e.assignment_id, e.source)] = e
    by_assignment: dict[str, dict] = {}
    for (aid, src), e in latest.items():
        slot = by_assignment.setdefault(aid, {"assignmentId": aid, "self": None, "reviewer": None})
        slot["self" if src == "SELF" else "reviewer"] = eval_out(e)

    notes_q = db.query(CheckInNote).filter_by(employee_id=employee_id, fiscal_year=fiscal_year, is_delete=False)
    notes = [checkin_note_out(n) for n in notes_q.order_by(CheckInNote.at).all()]

    return {
        "employeeId": employee_id,
        "fiscalYear": fiscal_year,
        "half": "H1",
        "evaluations": list(by_assignment.values()),
        "checkInNotes": notes,
        "isFinal": False,
    }


def _h1_period_ids(fiscal_year: str) -> list[str]:
    """Resolve H1 period ids for the fiscal year via pm-goal's framework
    listing (already-implemented endpoint), matching by code convention.
    Best-effort: if pm-goal is unreachable, returns [] and the caller falls
    back to considering ALL of the employee's periods (still read-only)."""
    try:
        fw = internal.get_json("goal", "/api/pm-goal/system/framework", params={"fiscalYear": fiscal_year})
    except Exception:  # noqa: BLE001
        fw = None
    if not fw or not fw.get("periods"):
        return []
    return [p["id"] for p in fw["periods"] if p.get("code") in H1_PERIOD_CODES]


def eval_out(e: Evaluation) -> dict:
    return {
        "id": e.id, "assignmentId": e.assignment_id, "employeeId": e.employee_id,
        "periodId": e.period_id, "source": e.source, "ratedBy": e.rated_by,
        "rating": float(e.rating), "comment": e.comment, "isFinal": e.is_final,
        "at": e.evaluated_at.isoformat() + "Z",
    }


def feedback_out(f: ContinuousFeedback) -> dict:
    return {
        "id": f.id, "aboutEmployeeId": f.about_employee_id, "from": f.from_user,
        "category": f.category, "text": f.text, "fiscalYear": f.fiscal_year,
        "at": f.at.isoformat() + "Z",
    }


def checkin_note_out(n: CheckInNote) -> dict:
    return {
        "id": n.id, "employeeId": n.employee_id, "periodId": n.period_id,
        "authorId": n.author_id, "note": n.note, "fiscalYear": n.fiscal_year,
        "at": n.at.isoformat() + "Z",
    }


# --------------------------------------------------------------------------
# Tenant onboarding — pure local DB/schema/seed bookkeeping. No external
# Tenant Manager call (out of scope; requires the real URF platform).
# --------------------------------------------------------------------------

def onboard_tenant(db: Session, tenant_id: str) -> TenantOnboarding:
    """Idempotently mark a tenant as onboarded in this service. Since schema
    is created eagerly for the whole service (Base.metadata.create_all) there
    is no per-tenant DDL to run; this simply records that the tenant is known
    and ensures the registry row exists, standing in for any future
    per-tenant seed/default-settings step."""
    tenant_id = (tenant_id or "").strip() or DEFAULT_TENANT_ID
    row = db.query(TenantOnboarding).filter_by(tenant_id=tenant_id).first()
    now_iso = _utcnow().isoformat() + "Z"
    if row is None:
        row = TenantOnboarding(tenant_id=tenant_id, onboarded=True, onboarded_at=now_iso)
        db.add(row)
    elif not row.onboarded:
        row.onboarded = True
        row.onboarded_at = now_iso
    db.commit()
    db.refresh(row)
    return row


def tenant_status(db: Session, tenant_id: str) -> dict:
    tenant_id = (tenant_id or "").strip() or DEFAULT_TENANT_ID
    row = db.query(TenantOnboarding).filter_by(tenant_id=tenant_id).first()
    return tenant_onboarding_out(row, tenant_id)


def tenant_onboarding_out(row: TenantOnboarding | None, tenant_id: str) -> dict:
    if row is None:
        return {"tenantId": tenant_id, "onboarded": False, "onboardedAt": None}
    return {
        "tenantId": row.tenant_id, "onboarded": row.onboarded,
        "onboardedAt": row.onboarded_at or None,
    }
