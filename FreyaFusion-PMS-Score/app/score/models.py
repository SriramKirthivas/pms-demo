"""pm-score domain entities: IPF scorecard, breakdown, bands, 9-box,
development plan, calibration adjustments."""

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from ..common.db import Base, URFMixin


def _id() -> str:
    return f"pmscore:{uuid.uuid4().hex}"


class IPFScorecard(URFMixin, Base):
    __tablename__ = "tb_pm_ipf_scorecard"
    __table_args__ = (
        Index("ix_pm_ipf_scorecard_tenant_delete", "tenant_id", "is_delete"),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_id)
    employee_id: Mapped[str] = mapped_column(String, index=True)
    fiscal_year: Mapped[str] = mapped_column(String, index=True)
    self_final_ipf: Mapped[float] = mapped_column(Float, default=0.0)
    manager_final_ipf: Mapped[float] = mapped_column(Float, default=0.0)
    band_self: Mapped[str] = mapped_column(String, default="")
    band_manager: Mapped[str] = mapped_column(String, default="")
    suggested_action: Mapped[str] = mapped_column(String, default="")
    partial_year: Mapped[bool] = mapped_column(Boolean, default=False)
    participated_periods: Mapped[str] = mapped_column(String, default="")  # CSV, e.g. "Q3,Q4"
    # lifecycle: DRAFT -> INCOMPLETE -> ACKNOWLEDGED -> SIGNED_OFF
    state: Mapped[str] = mapped_column(String, default="DRAFT")
    acknowledged_by: Mapped[str] = mapped_column(String, default="")
    # Note: annotated as Mapped[datetime] (not Optional[datetime]) even though
    # nullable=True — SQLAlchemy 2.0.36 on Python 3.14 fails to resolve
    # stringified `X | None` / Optional[X] annotations (typing.py internals
    # changed); the nullable=True on the Column is what actually matters.
    acknowledged_at: Mapped[datetime] = mapped_column(DateTime, nullable=True)
    signed_off_by: Mapped[str] = mapped_column(String, default="")
    signed_off_at: Mapped[datetime] = mapped_column(DateTime, nullable=True)
    incomplete_reason: Mapped[str] = mapped_column(String, default="")


class ScorecardBreakdown(URFMixin, Base):
    """Per-period, per-pillar contribution breakdown backing a scorecard, so
    GET /scorecards/breakdown can reconstruct exactly how the Final IPF was
    assembled without recomputing."""

    __tablename__ = "tb_pm_scorecard_breakdown"
    __table_args__ = (
        Index("ix_pm_scorecard_breakdown_emp_fy", "employee_id", "fiscal_year"),
        Index("ix_pm_scorecard_breakdown_tenant_delete", "tenant_id", "is_delete"),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_id)
    employee_id: Mapped[str] = mapped_column(String, index=True)
    fiscal_year: Mapped[str] = mapped_column(String, index=True)
    period: Mapped[str] = mapped_column(String, default="")  # Q1..Q4 | ANNUAL
    pillar: Mapped[str] = mapped_column(String, default="")
    self_score: Mapped[float] = mapped_column(Float, nullable=True)
    manager_score: Mapped[float] = mapped_column(Float, nullable=True)
    self_contribution: Mapped[float] = mapped_column(Float, nullable=True)
    manager_contribution: Mapped[float] = mapped_column(Float, nullable=True)


class PerformanceBand(URFMixin, Base):
    """Seeded per tenant on tenant onboarding; ipf.band_for() reads these,
    falling back to hardcoded defaults when the table is empty."""

    __tablename__ = "tb_pm_performance_band"
    __table_args__ = (
        Index("ix_pm_performance_band_tenant_delete", "tenant_id", "is_delete"),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_id)
    range_low: Mapped[float] = mapped_column(Float)
    range_high: Mapped[float] = mapped_column(Float)
    label: Mapped[str] = mapped_column(String)
    suggested_action: Mapped[str] = mapped_column(String, default="")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)


class NineBox(URFMixin, Base):
    __tablename__ = "tb_pm_nine_box"
    __table_args__ = (
        Index("ix_pm_nine_box_tenant_delete", "tenant_id", "is_delete"),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_id)
    employee_id: Mapped[str] = mapped_column(String, index=True)
    fiscal_year: Mapped[str] = mapped_column(String, index=True)
    performance_level: Mapped[int] = mapped_column(Integer, default=2)  # from IPF band
    potential_level: Mapped[int] = mapped_column(Integer, default=2)  # auto from feedback, or manager-set
    # "AUTO" = potential derived from continuous feedback on compute; "MANUAL" =
    # a manager/HR placed or calibrated it, so auto must not overwrite it.
    potential_source: Mapped[str] = mapped_column(String, default="AUTO")
    box_label: Mapped[str] = mapped_column(String, default="")
    department: Mapped[str] = mapped_column(String, default="", index=True)


class DevelopmentPlan(URFMixin, Base):
    __tablename__ = "tb_pm_development_plan"
    __table_args__ = (
        Index("ix_pm_development_plan_emp_fy", "employee_id", "fiscal_year"),
        Index("ix_pm_development_plan_tenant_delete", "tenant_id", "is_delete"),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_id)
    employee_id: Mapped[str] = mapped_column(String, index=True)
    fiscal_year: Mapped[str] = mapped_column(String, index=True)
    review_stage: Mapped[str] = mapped_column(String, default="EOY")  # MID_YEAR | EOY
    key_strengths: Mapped[str] = mapped_column(String, default="")
    improvement_areas: Mapped[str] = mapped_column(String, default="")
    next_fy_plan: Mapped[str] = mapped_column(String, default="")
    recommended_trainings: Mapped[str] = mapped_column(String, default="")
    stretch_assignments: Mapped[str] = mapped_column(String, default="")
    mentorship_plan: Mapped[str] = mapped_column(String, default="")
    career_milestones: Mapped[str] = mapped_column(String, default="")


class CalibrationAdjustment(URFMixin, Base):
    __tablename__ = "tb_pm_calibration_adjustment"
    __table_args__ = (
        Index("ix_pm_calibration_adjustment_emp_fy", "employee_id", "fiscal_year"),
        Index("ix_pm_calibration_adjustment_tenant_delete", "tenant_id", "is_delete"),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_id)
    employee_id: Mapped[str] = mapped_column(String, index=True)
    fiscal_year: Mapped[str] = mapped_column(String, index=True)
    original_value: Mapped[float] = mapped_column(Float, default=0.0)
    adjusted_value: Mapped[float] = mapped_column(Float, default=0.0)
    adjusted_by: Mapped[str] = mapped_column(String, default="")
    reason: Mapped[str] = mapped_column(String, default="")
    adjusted_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
