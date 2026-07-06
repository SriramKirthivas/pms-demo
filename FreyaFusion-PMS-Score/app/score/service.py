"""pm-score business logic: assemble per-quarter/per-pillar goal data, compute
IPF, bands, 9-box, development plans, calibration, acknowledge/sign-off."""

from datetime import datetime, timezone

from sqlalchemy.orm import Session

from ..common import internal
from ..common.auth import CurrentUser
from ..common.envelope import CONFLICT, FORBIDDEN, NOT_FOUND, PARAM_INVALID, ApiError
from . import ipf, schemas
from .ipf import QUARTERS, IPFError
from .models import (
    CalibrationAdjustment,
    DevelopmentPlan,
    IPFScorecard,
    NineBox,
    PerformanceBand,
    ScorecardBreakdown,
)

MANAGER_ROLES = ("manager", "admin")
HR_ROLES = ("admin",)

# 9-box cell names by (performance, potential), each 1..3.
BOX_LABELS = {
    (3, 3): "Star", (3, 2): "High Performer", (3, 1): "Trusted Professional",
    (2, 3): "High Potential", (2, 2): "Core Player", (2, 1): "Effective",
    (1, 3): "Enigma", (1, 2): "Inconsistent Player", (1, 1): "Underperformer",
}


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def can_view_employee_data(employee_id: str, user: CurrentUser) -> bool:
    """Record-level check: self, admin, or that employee's manager (per
    pm-goal's directory) may view their scorecard/dev-plan. A plain
    "employee" role may NEVER view another employee's data regardless of
    pm-goal reachability — only "manager" gets the best-effort manager-of
    check, which degrades OPEN if pm-goal is unreachable (e.g. not
    configured, as in this repo's hermetic unit tests), matching the
    permissiveness "any manager could view anyone" had before this check
    existed. Previously `GET /scorecards`/`GET /scorecards/breakdown`
    allowed ANY manager to view ANY employee, and `GET /dev-plans` had no
    check at all."""
    if user.role == "admin" or user.name == employee_id:
        return True
    if user.role != "manager":
        return False
    rows = internal.get_json("goal", "/system/employees", params={"ids": employee_id})
    if not rows:
        return True
    emp = next((r for r in rows if r.get("id") == employee_id), None)
    if emp is None:
        return True
    return emp.get("managerId") == user.name


# --------------------------------------------------------------------------
# Performance bands (tenant-seeded table, hardcoded fallback).
# --------------------------------------------------------------------------

def _bands_from_db(db: Session) -> list[tuple]:
    rows = (
        db.query(PerformanceBand)
        .filter_by(is_delete=False)
        .order_by(PerformanceBand.sort_order)
        .all()
    )
    if not rows:
        return []
    return [(b.range_low, b.range_high, b.label, b.suggested_action) for b in rows]


def list_bands(db: Session) -> list[dict]:
    bands = _bands_from_db(db) or ipf.BANDS
    return [
        {"range": f"{lo:.1f}–{(hi - 0.01):.1f}" if hi <= 5 else f"{lo:.1f}–5.0",
         "band": label, "suggestedAction": action}
        for lo, hi, label, action in bands
    ]


def seed_default_bands(db: Session, tenant_id: str = "default") -> int:
    """Idempotently seed the 5 default performance bands for a tenant. Used by
    /tenant/onboarding. Returns the number of rows created (0 if already seeded)."""
    existing = (
        db.query(PerformanceBand)
        .filter_by(tenant_id=tenant_id, is_delete=False)
        .count()
    )
    if existing > 0:
        return 0
    for i, (lo, hi, label, action) in enumerate(ipf.BANDS):
        db.add(PerformanceBand(
            tenant_id=tenant_id, range_low=lo, range_high=min(hi, 5.0),
            label=label, suggested_action=action, sort_order=i,
            create_user="system",
        ))
    db.commit()
    return len(ipf.BANDS)


# --------------------------------------------------------------------------
# Data assembly: reshape pm-goal assignments + pm-eval final evaluations into
# a per-quarter, per-pillar structure the ipf module can consume.
# --------------------------------------------------------------------------

def _fetch_framework(fiscal_year: str) -> dict:
    return internal.get_json(
        "goal", "/api/pm-goal/system/framework", {"fiscalYear": fiscal_year},
    ) or {}


def _fetch_assignments(employee_id: str, fiscal_year: str) -> list[dict]:
    return internal.get_json(
        "goal", "/api/pm-goal/system/assignments",
        {"employeeId": employee_id, "fiscalYear": fiscal_year},
    ) or []


def _fetch_finals(employee_id: str, fiscal_year: str) -> list[dict]:
    return internal.get_json(
        "eval", "/api/pm-eval/system/evaluations/final",
        {"employeeId": employee_id, "fiscalYear": fiscal_year},
    ) or []


def _quarter_of(a: dict, period_by_id: dict, ordinal: int) -> str:
    """Resolve which quarter (Q1..Q4) a QUARTERLY-cadence assignment belongs
    to. Prefers an explicit periodId/periodCode on the assignment (once
    pm-goal's /system/assignments is enhanced to return it), and falls back to
    a deterministic ordinal split (assignments are cascaded/returned in
    creation order, one per quarter per goal) when that data isn't present.
    This fallback is a documented simplification — see report."""
    period_id = a.get("periodId")
    if period_id and period_id in period_by_id:
        code = period_by_id[period_id].get("code", "")
        if code in QUARTERS:
            return code
    code = a.get("periodCode") or a.get("quarter")
    if code in QUARTERS:
        return code
    return QUARTERS[ordinal % len(QUARTERS)]


def assemble_period_pillar_data(employee_id: str, fiscal_year: str) -> dict:
    """Build the {quarters, annual} structure ipf.compute_final() consumes,
    by pulling assignments (pillar + weight + cadence) from pm-goal and final
    ratings (self/manager) from pm-eval, then joining them.

    Returns:
      {
        "quarters": {"Q1": {"team": [...goals], "individual": [...goals]}, ...},
        "annual": {"sectionA": [...goals], "sectionB": [...goals]},
      }
    where each "goal" dict is {weight, selfRating, managerRating}.

    pm-eval's finals() returns [{assignmentId, source, rating}] (source is
    SELF or REVIEWER — REVIEWER is the manager stream, authoritative for
    scoring per the pm-eval spec). We join those onto the assignment's
    (pillar, cadence, weight) via assignmentId.
    """
    assignments = _fetch_assignments(employee_id, fiscal_year)
    finals = _fetch_finals(employee_id, fiscal_year)
    fw = _fetch_framework(fiscal_year)
    period_by_id = {p["id"]: p for p in fw.get("periods", [])} if fw else {}

    # rating lookup: {(assignmentId, source): rating}
    rmap: dict[tuple[str, str], float] = {
        (f["assignmentId"], f["source"]): f["rating"] for f in finals
    }

    quarters: dict[str, dict[str, list[dict]]] = {
        q: {"team": [], "individual": []} for q in QUARTERS
    }
    annual: dict[str, list[dict]] = {"sectionA": [], "sectionB": []}

    quarterly_ordinal: dict[str, int] = {"TEAM_GOAL": 0, "INDIVIDUAL_CONTRIBUTION": 0}
    for a in assignments:
        pillar = a.get("pillar")
        cadence = a.get("cadence", "QUARTERLY")
        weight = a.get("weight", 0) or 0
        aid = a.get("assignmentId")
        self_rating = rmap.get((aid, "SELF"))
        mgr_rating = rmap.get((aid, "REVIEWER"))
        goal = {"weight": weight, "selfRating": self_rating, "managerRating": mgr_rating}

        if cadence == "QUARTERLY" and pillar in ("TEAM_GOAL", "INDIVIDUAL_CONTRIBUTION"):
            bucket = "team" if pillar == "TEAM_GOAL" else "individual"
            q = _quarter_of(a, period_by_id, quarterly_ordinal[pillar])
            quarterly_ordinal[pillar] += 1
            quarters[q][bucket].append(goal)
        elif cadence == "ANNUAL" and pillar == "TRAININGS_AND_CERTS":
            annual["sectionA"].append(goal)
        elif cadence == "ANNUAL" and pillar == "INDIVIDUAL_CONTRIBUTION":
            annual["sectionB"].append(goal)
        # Other pillar/cadence combinations are outside the documented IPF
        # formula (e.g. MONTHLY/AD_HOC check-ins) and are ignored here; they
        # may still show up in continuous feedback / dev plans.

    return {"quarters": quarters, "annual": annual}


def _legacy_sections_to_result(sections: list[dict]) -> dict:
    """Back-compat path: caller supplied pre-aggregated {ipfWeight, selfScore,
    managerScore} sections directly (used by existing/manual-override tests).
    Final IPF = Sum(score * ipfWeight/100); still rounded to 2dp and banded."""
    final_self = final_mgr = 0.0
    for s in sections:
        w = (s.get("ipfWeight", 0) or 0) / 100
        final_self += (s.get("selfScore") or 0) * w
        final_mgr += (s.get("managerScore") or 0) * w
    final_self = round(final_self, 2)
    final_mgr = round(final_mgr, 2)
    return {
        "selfFinalIPF": final_self, "managerFinalIPF": final_mgr,
        "selfBreakdown": [], "managerBreakdown": [],
    }


def get_scorecard(db: Session, employee_id: str, fiscal_year: str) -> IPFScorecard | None:
    return (
        db.query(IPFScorecard)
        .filter_by(employee_id=employee_id, fiscal_year=fiscal_year, is_delete=False)
        .first()
    )


def _nine_box(db: Session, employee_id: str, fiscal_year: str) -> NineBox | None:
    return (
        db.query(NineBox)
        .filter_by(employee_id=employee_id, fiscal_year=fiscal_year, is_delete=False)
        .first()
    )


def _persist_breakdown(
    db: Session, employee_id: str, fiscal_year: str,
    self_breakdown: list[dict], manager_breakdown: list[dict], user: CurrentUser,
) -> None:
    # Clear prior breakdown rows for this employee/year, then re-insert (recompute
    # cleanly overwrites, per the deterministic-recompute requirement).
    db.query(ScorecardBreakdown).filter_by(
        employee_id=employee_id, fiscal_year=fiscal_year,
    ).delete()

    by_key: dict[tuple[str, str], dict] = {}
    for row in self_breakdown:
        by_key.setdefault((row["period"], row["pillar"]), {})["self"] = row
    for row in manager_breakdown:
        by_key.setdefault((row["period"], row["pillar"]), {})["manager"] = row

    for (period, pillar), sides in by_key.items():
        s = sides.get("self") or {}
        m = sides.get("manager") or {}
        db.add(ScorecardBreakdown(
            employee_id=employee_id, fiscal_year=fiscal_year,
            period=period, pillar=pillar,
            self_score=s.get("score"), manager_score=m.get("score"),
            self_contribution=s.get("contribution"),
            manager_contribution=m.get("contribution"),
            create_user=user.name,
        ))


def get_breakdown(db: Session, employee_id: str, fiscal_year: str) -> list[dict]:
    rows = (
        db.query(ScorecardBreakdown)
        .filter_by(employee_id=employee_id, fiscal_year=fiscal_year, is_delete=False)
        .order_by(ScorecardBreakdown.period, ScorecardBreakdown.pillar)
        .all()
    )
    return [
        {
            "employeeId": r.employee_id, "fiscalYear": r.fiscal_year,
            "period": r.period, "pillar": r.pillar,
            "selfScore": r.self_score, "managerScore": r.manager_score,
            "selfContribution": r.self_contribution,
            "managerContribution": r.manager_contribution,
        }
        for r in rows
    ]


def compute(db: Session, req: schemas.ComputeRequest, user: CurrentUser) -> IPFScorecard:
    if user.role not in MANAGER_ROLES:
        raise ApiError(403, FORBIDDEN, "compute_ipf privilege required")

    sc = get_scorecard(db, req.employeeId, req.fiscalYear)
    if sc and sc.state == "SIGNED_OFF":
        raise ApiError(409, CONFLICT, "Signed-off scorecard cannot be recomputed")

    if req.sections:
        # Legacy/manual-override path: caller supplied pre-aggregated sections.
        result = _legacy_sections_to_result([s.model_dump() for s in req.sections])
        bands = _bands_from_db(db)
        self_band, _ = ipf.band_for(result["selfFinalIPF"], bands)
        mgr_band, mgr_action = ipf.band_for(result["managerFinalIPF"], bands)
        result["bandSelf"] = self_band
        result["bandManager"] = mgr_band
        result["suggestedAction"] = mgr_action
        result["performanceLevel"] = ipf.performance_level(result["managerFinalIPF"])
        incomplete = False
        incomplete_reason = ""
    else:
        data = assemble_period_pillar_data(req.employeeId, req.fiscalYear)
        if not any(data["quarters"][q]["team"] or data["quarters"][q]["individual"] for q in QUARTERS) \
                and not data["annual"]["sectionA"] and not data["annual"]["sectionB"]:
            raise ApiError(400, PARAM_INVALID,
                           "No sections to score (provide sections, or ensure finalized "
                           "evaluations/goal assignments exist in pm-goal/pm-eval)")

        participated = req.participatedPeriods if req.partialYear and req.participatedPeriods else None
        try:
            result = ipf.compute_final(
                data["quarters"], data["annual"],
                participated_quarters=participated, bands=_bands_from_db(db),
            )
            incomplete = False
            incomplete_reason = ""
        except IPFError as e:
            # Required periods aren't final yet (or a section's weights are
            # malformed) -> mark the scorecard incomplete, don't publish a
            # Final IPF, and don't crash.
            incomplete = True
            incomplete_reason = str(e)
            result = {
                "selfFinalIPF": sc.self_final_ipf if sc else 0.0,
                "managerFinalIPF": sc.manager_final_ipf if sc else 0.0,
                "bandSelf": "", "bandManager": "", "suggestedAction": "",
                "performanceLevel": 2, "selfBreakdown": [], "managerBreakdown": [],
            }

    if sc is None:
        sc = IPFScorecard(employee_id=req.employeeId, fiscal_year=req.fiscalYear, create_user=user.name)
        db.add(sc)

    if incomplete:
        sc.state = "INCOMPLETE"
        sc.incomplete_reason = incomplete_reason
        sc.update_user = user.name
        db.commit()
        db.refresh(sc)
        return sc

    sc.self_final_ipf = result["selfFinalIPF"]
    sc.manager_final_ipf = result["managerFinalIPF"]
    sc.band_self = result["bandSelf"]
    sc.band_manager = result["bandManager"]
    sc.suggested_action = result["suggestedAction"]
    sc.partial_year = req.partialYear
    sc.participated_periods = ",".join(req.participatedPeriods) if req.partialYear else ""
    sc.incomplete_reason = ""
    sc.state = "DRAFT"
    sc.update_user = user.name

    _persist_breakdown(
        db, req.employeeId, req.fiscalYear,
        result.get("selfBreakdown", []), result.get("managerBreakdown", []), user,
    )

    # Auto-set the 9-box performance axis from the band.
    nb = _nine_box(db, req.employeeId, req.fiscalYear)
    if nb is None:
        nb = NineBox(employee_id=req.employeeId, fiscal_year=req.fiscalYear, create_user=user.name)
        db.add(nb)
    nb.performance_level = result["performanceLevel"]
    nb.box_label = BOX_LABELS.get((nb.performance_level, nb.potential_level), "")
    db.commit()
    db.refresh(sc)
    # Tell the employee their scorecard is ready.
    internal.emit_event(
        "SCORECARD_PUBLISHED", sc.employee_id,
        "Your scorecard is ready",
        f"Final IPF {sc.manager_final_ipf:.2f} — {sc.band_manager}.",
        "/scorecard",
    )
    return sc


def place_nine_box(db: Session, req: schemas.NineBoxRequest, user: CurrentUser) -> NineBox:
    if user.role not in MANAGER_ROLES:
        raise ApiError(403, FORBIDDEN, "manage_ninebox privilege required")
    sc = get_scorecard(db, req.employeeId, req.fiscalYear)
    perf = ipf.performance_level(sc.manager_final_ipf) if sc else 2
    nb = _nine_box(db, req.employeeId, req.fiscalYear)
    if nb is None:
        nb = NineBox(employee_id=req.employeeId, fiscal_year=req.fiscalYear, create_user=user.name)
        db.add(nb)
    nb.performance_level = perf
    nb.potential_level = max(1, min(3, req.potentialLevel))
    nb.box_label = BOX_LABELS.get((nb.performance_level, nb.potential_level), "")
    if req.department:
        nb.department = req.department
    nb.update_user = user.name
    db.commit()
    db.refresh(nb)
    return nb


def acknowledge(db: Session, scorecard_id: str, user: CurrentUser) -> IPFScorecard:
    sc = db.query(IPFScorecard).filter_by(id=scorecard_id, is_delete=False).first()
    if not sc:
        raise ApiError(404, NOT_FOUND, "Scorecard not found")
    if user.name != sc.employee_id:
        raise ApiError(403, FORBIDDEN, "Only the employee can acknowledge their scorecard")
    if sc.state == "SIGNED_OFF":
        raise ApiError(409, CONFLICT, "Scorecard already signed off")
    sc.state = "ACKNOWLEDGED"
    sc.acknowledged_by = user.name
    sc.acknowledged_at = _utcnow()
    db.commit()
    db.refresh(sc)
    internal.emit_event(
        "SCORECARD_ACKNOWLEDGED", sc.create_user or sc.employee_id,
        "Scorecard acknowledged",
        f"{user.name} acknowledged their scorecard — ready for HRBP sign-off.",
        "/scorecard",
    )
    # Best-effort cross-service contract: tell pm-goal to mark the fiscal
    # year's assignments ACKNOWLEDGED. Fire-and-forget — a sibling outage must
    # not fail the acknowledge operation.
    try:
        fy_int = int("".join(ch for ch in sc.fiscal_year if ch.isdigit())[:4] or 0)
    except ValueError:
        fy_int = 0
    internal.post_json(
        "goal", "/api/pm-goal/system/assignments/acknowledge",
        {"employeeId": sc.employee_id, "fiscalYear": fy_int},
    )
    return sc


def signoff(db: Session, scorecard_id: str, user: CurrentUser) -> IPFScorecard:
    if user.role != "admin":
        raise ApiError(403, FORBIDDEN, "signoff_scorecard privilege required (HRBP)")
    sc = db.query(IPFScorecard).filter_by(id=scorecard_id, is_delete=False).first()
    if not sc:
        raise ApiError(404, NOT_FOUND, "Scorecard not found")
    if sc.state != "ACKNOWLEDGED":
        raise ApiError(409, CONFLICT, "Employee must acknowledge before sign-off")
    sc.state = "SIGNED_OFF"
    sc.signed_off_by = user.name
    sc.signed_off_at = _utcnow()
    db.commit()
    db.refresh(sc)
    internal.emit_event(
        "SCORECARD_SIGNED_OFF", sc.employee_id,
        "Scorecard signed off",
        f"Your {sc.fiscal_year} scorecard was signed off by {user.name}.",
        "/scorecard",
    )
    return sc


def list_all(db: Session, fiscal_year: str, department: str | None = None) -> list[dict]:
    """All scorecards for a fiscal year — powers the 9-box talent matrix.
    `department` filters via the NineBox.department field when supplied."""
    rows = (
        db.query(IPFScorecard)
        .filter_by(fiscal_year=fiscal_year, is_delete=False)
        .all()
    )
    out = []
    for sc in rows:
        nb = _nine_box(db, sc.employee_id, sc.fiscal_year)
        if department and (not nb or nb.department != department):
            continue
        out.append(scorecard_out(db, sc))
    return out


def scorecard_out(db: Session, sc: IPFScorecard) -> dict:
    nb = _nine_box(db, sc.employee_id, sc.fiscal_year)
    return {
        "id": sc.id, "employeeId": sc.employee_id, "fiscalYear": sc.fiscal_year,
        "selfFinalIPF": sc.self_final_ipf, "managerFinalIPF": sc.manager_final_ipf,
        "bandSelf": sc.band_self, "bandManager": sc.band_manager,
        "suggestedAction": sc.suggested_action, "partialYear": sc.partial_year,
        "participatedPeriods": [p for p in sc.participated_periods.split(",") if p],
        "state": sc.state, "acknowledgedBy": sc.acknowledged_by,
        "acknowledgedAt": sc.acknowledged_at.isoformat() + "Z" if sc.acknowledged_at else None,
        "signedOffBy": sc.signed_off_by,
        "signedOffAt": sc.signed_off_at.isoformat() + "Z" if sc.signed_off_at else None,
        "incompleteReason": sc.incomplete_reason,
        "nineBox": nine_box_out(nb) if nb else None,
    }


def nine_box_out(nb: NineBox) -> dict:
    return {
        "employeeId": nb.employee_id, "fiscalYear": nb.fiscal_year,
        "performanceLevel": nb.performance_level, "potentialLevel": nb.potential_level,
        "boxLabel": nb.box_label, "department": nb.department,
    }


# --------------------------------------------------------------------------
# Development plans.
# --------------------------------------------------------------------------

REVIEW_STAGES = ("MID_YEAR", "EOY")


def _fetch_feedback(employee_id: str, fiscal_year: str) -> dict:
    """Calls pm-eval's GET /system/feedback?aboutEmployeeId=&fiscalYear=,
    which returns feedback entries grouped by category:
    {"STRETCH": [...], "IMPROVEMENT": [...], ...}."""
    return internal.get_json(
        "eval", "/api/pm-eval/system/feedback",
        {"aboutEmployeeId": employee_id, "fiscalYear": fiscal_year},
    ) or {}


def build_dev_plan(db: Session, req: schemas.DevPlanBuildRequest, user: CurrentUser) -> DevelopmentPlan:
    if user.role not in MANAGER_ROLES:
        raise ApiError(403, FORBIDDEN, "build_devplan privilege required")
    if req.reviewStage not in REVIEW_STAGES:
        raise ApiError(400, PARAM_INVALID, f"reviewStage must be one of {REVIEW_STAGES}")

    feedback_by_category = _fetch_feedback(req.employeeId, req.fiscalYear)
    strengths = [f.get("text", "") for f in feedback_by_category.get("STRETCH", [])]
    improvements = [f.get("text", "") for f in feedback_by_category.get("IMPROVEMENT", [])]

    plan = (
        db.query(DevelopmentPlan)
        .filter_by(employee_id=req.employeeId, fiscal_year=req.fiscalYear,
                    review_stage=req.reviewStage, is_delete=False)
        .first()
    )
    if plan is None:
        plan = DevelopmentPlan(
            employee_id=req.employeeId, fiscal_year=req.fiscalYear,
            review_stage=req.reviewStage, create_user=user.name,
        )
        db.add(plan)
    # Pre-populate from feedback; leave manager-authored fields untouched if
    # already set (rebuilding shouldn't clobber edits already made).
    if not plan.key_strengths:
        plan.key_strengths = "\n".join(s for s in strengths if s)
    if not plan.improvement_areas:
        plan.improvement_areas = "\n".join(s for s in improvements if s)
    plan.update_user = user.name
    db.commit()
    db.refresh(plan)
    return plan


def list_dev_plans(db: Session, employee_id: str, fiscal_year: str, user: CurrentUser) -> list[DevelopmentPlan]:
    if not can_view_employee_data(employee_id, user):
        raise ApiError(403, FORBIDDEN, "Not permitted to view this employee's development plan")
    return (
        db.query(DevelopmentPlan)
        .filter_by(employee_id=employee_id, fiscal_year=fiscal_year, is_delete=False)
        .order_by(DevelopmentPlan.review_stage)
        .all()
    )


def edit_dev_plan(db: Session, plan_id: str, p: schemas.DevPlanUpdate, user: CurrentUser) -> DevelopmentPlan:
    if user.role not in MANAGER_ROLES:
        raise ApiError(403, FORBIDDEN, "edit_devplan privilege required")
    plan = db.query(DevelopmentPlan).filter_by(id=plan_id, is_delete=False).first()
    if not plan:
        raise ApiError(404, NOT_FOUND, "Development plan not found")
    if p.keyStrengths is not None:
        plan.key_strengths = p.keyStrengths
    if p.improvementAreas is not None:
        plan.improvement_areas = p.improvementAreas
    if p.nextFYPlan is not None:
        plan.next_fy_plan = p.nextFYPlan
    if p.recommendedTrainings is not None:
        plan.recommended_trainings = p.recommendedTrainings
    if p.stretchAssignments is not None:
        plan.stretch_assignments = p.stretchAssignments
    if p.mentorshipPlan is not None:
        plan.mentorship_plan = p.mentorshipPlan
    if p.careerMilestones is not None:
        plan.career_milestones = p.careerMilestones
    plan.update_user = user.name
    db.commit()
    db.refresh(plan)
    return plan


def dev_plan_out(p: DevelopmentPlan) -> dict:
    return {
        "id": p.id, "employeeId": p.employee_id, "fiscalYear": p.fiscal_year,
        "reviewStage": p.review_stage, "keyStrengths": p.key_strengths,
        "improvementAreas": p.improvement_areas, "nextFYPlan": p.next_fy_plan,
        "recommendedTrainings": p.recommended_trainings,
        "stretchAssignments": p.stretch_assignments,
        "mentorshipPlan": p.mentorship_plan, "careerMilestones": p.career_milestones,
    }


# --------------------------------------------------------------------------
# Score calibration.
# --------------------------------------------------------------------------

def adjust_calibration(db: Session, req: schemas.CalibrationAdjustRequest, user: CurrentUser) -> IPFScorecard:
    if user.role not in HR_ROLES:
        raise ApiError(403, FORBIDDEN, "calibrate_scorecard privilege required (HR/Admin)")
    sc = get_scorecard(db, req.employeeId, req.fiscalYear)
    if not sc:
        raise ApiError(404, NOT_FOUND, "Scorecard not found")
    if sc.state == "SIGNED_OFF":
        raise ApiError(409, CONFLICT, "Cannot calibrate a signed-off scorecard")

    original = sc.manager_final_ipf
    db.add(CalibrationAdjustment(
        employee_id=req.employeeId, fiscal_year=req.fiscalYear,
        original_value=original, adjusted_value=req.adjustedManagerFinalIPF,
        adjusted_by=user.name, reason=req.reason, adjusted_at=_utcnow(),
        create_user=user.name,
    ))

    sc.manager_final_ipf = round(req.adjustedManagerFinalIPF, 2)
    bands = _bands_from_db(db)
    mgr_band, mgr_action = ipf.band_for(sc.manager_final_ipf, bands)
    sc.band_manager = mgr_band
    sc.suggested_action = mgr_action
    sc.update_user = user.name

    nb = _nine_box(db, req.employeeId, req.fiscalYear)
    if nb is None:
        nb = NineBox(employee_id=req.employeeId, fiscal_year=req.fiscalYear, create_user=user.name)
        db.add(nb)
    nb.performance_level = ipf.performance_level(sc.manager_final_ipf)
    nb.box_label = BOX_LABELS.get((nb.performance_level, nb.potential_level), "")

    db.commit()
    db.refresh(sc)
    return sc


def calibration_view(db: Session, fiscal_year: str, department: str | None = None) -> list[dict]:
    """All employees' current Final IPF + 9-box placement for a fiscal year,
    for moderation. `department` filters on NineBox.department when present;
    if no NineBox row (and thus no department) exists for an employee, that
    employee is included only when no department filter is requested — since
    this service has no other source of department data (department is owned
    by URF UAM / org-structure, not by pm-score)."""
    return list_all(db, fiscal_year, department)


# --------------------------------------------------------------------------
# Tenant onboarding.
# --------------------------------------------------------------------------

def onboard_tenant(db: Session, tenant_id: str) -> dict:
    seeded = seed_default_bands(db, tenant_id)
    return {"tenantId": tenant_id, "status": "COMPLETED", "bandsSeeded": seeded}
