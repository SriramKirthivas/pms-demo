"""pm-goal domain entities. (Increment 1: framework + review periods.)"""

import uuid
from datetime import datetime, timezone
from enum import Enum

from sqlalchemy import JSON, Boolean, DateTime, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from ..common.db import Base, URFMixin


def _id() -> str:
    return f"pmgoal:{uuid.uuid4().hex}"


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class ReviewCadence(str, Enum):
    MONTHLY = "MONTHLY"
    QUARTERLY = "QUARTERLY"
    ANNUAL = "ANNUAL"
    AD_HOC = "AD_HOC"


class GoalPillar(str, Enum):
    TEAM_GOAL = "TEAM_GOAL"
    INDIVIDUAL_CONTRIBUTION = "INDIVIDUAL_CONTRIBUTION"
    TRAININGS_AND_CERTS = "TRAININGS_AND_CERTS"


class GoalType(str, Enum):
    OKR = "OKR"
    KPI = "KPI"


class GoalStatus(str, Enum):
    DRAFT = "DRAFT"
    CASCADED = "CASCADED"


class AssignmentStatus(str, Enum):
    PENDING_ACCEPTANCE = "PENDING_ACCEPTANCE"
    CHANGE_REQUESTED = "CHANGE_REQUESTED"
    ACTIVE = "ACTIVE"
    COMPLETION_REQUESTED = "COMPLETION_REQUESTED"  # owner requested early completion
    COMPLETED = "COMPLETED"                        # manager approved early completion
    LOCKED = "LOCKED"
    CLOSED = "CLOSED"
    ACKNOWLEDGED = "ACKNOWLEDGED"


class AcceptanceState(str, Enum):
    PENDING = "PENDING"
    ACCEPTED = "ACCEPTED"
    REJECTED = "REJECTED"


class ParticipationRole(str, Enum):
    OWNER = "OWNER"
    SETTER = "SETTER"
    REVIEWER = "REVIEWER"


class UnlockRequestStatus(str, Enum):
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"


class AuditAction(str, Enum):
    CREATED = "CREATED"
    EDITED = "EDITED"
    CASCADED = "CASCADED"
    ACCEPTED = "ACCEPTED"
    REJECTED = "REJECTED"
    RATED = "RATED"
    LOCKED = "LOCKED"
    UNLOCK_REQUESTED = "UNLOCK_REQUESTED"
    UNLOCKED = "UNLOCKED"
    ACKNOWLEDGED = "ACKNOWLEDGED"
    REASSIGNED = "REASSIGNED"
    JOINER = "JOINER"
    LEAVER = "LEAVER"
    CLOSED = "CLOSED"
    COMPLETION_REQUESTED = "COMPLETION_REQUESTED"
    COMPLETED = "COMPLETED"
    COMPLETION_REJECTED = "COMPLETION_REJECTED"


class PerformanceFramework(URFMixin, Base):
    __tablename__ = "tb_pm_framework"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_id)
    fiscal_year: Mapped[str] = mapped_column(String, index=True)
    active_cadences: Mapped[list] = mapped_column(JSON, default=list)
    team_weight_pct: Mapped[int] = mapped_column(Integer, default=60)
    individual_weight_pct: Mapped[int] = mapped_column(Integer, default=40)
    # First calendar month of the fiscal year (1=Jan … 12=Dec). Drives the
    # derived quarter windows so the FY isn't hardcoded to Apr–Mar.
    start_month: Mapped[int] = mapped_column(Integer, default=4)


class ReviewPeriod(URFMixin, Base):
    __tablename__ = "tb_pm_review_period"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_id)
    framework_id: Mapped[str] = mapped_column(String, index=True)
    fiscal_year: Mapped[str] = mapped_column(String, index=True)
    code: Mapped[str] = mapped_column(String)  # Q1..Q4 | ANNUAL | M01..M12
    cadence: Mapped[str] = mapped_column(String)
    label: Mapped[str] = mapped_column(String, default="")
    window: Mapped[str] = mapped_column(String, default="")
    locked: Mapped[bool] = mapped_column(Boolean, default=False)


class Goal(URFMixin, Base):
    __tablename__ = "tb_pm_goal"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_id)
    fiscal_year: Mapped[str] = mapped_column(String, index=True)
    pillar: Mapped[str] = mapped_column(String, index=True)
    cadence: Mapped[str] = mapped_column(String, default="QUARTERLY")
    goal_type: Mapped[str] = mapped_column(String, default="OKR")  # OKR | KPI
    measure: Mapped[str] = mapped_column(String)
    description: Mapped[str] = mapped_column(String, default="")
    base_criteria: Mapped[str] = mapped_column(String, default="")  # 1/3/5 rubric
    default_weight: Mapped[int] = mapped_column(Integer, default=5)
    competencies: Mapped[list] = mapped_column(JSON, default=list)
    goal_status: Mapped[str] = mapped_column(String, default="DRAFT")
    setter_id: Mapped[str] = mapped_column(String, default="")


class GoalAssignment(URFMixin, Base):
    __tablename__ = "tb_pm_goal_assignment"
    __table_args__ = (
        Index("ix_pm_goal_assignment_period_status", "period_id", "assignment_status"),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_id)
    goal_id: Mapped[str] = mapped_column(String, index=True)
    fiscal_year: Mapped[str] = mapped_column(String, index=True)
    period_id: Mapped[str] = mapped_column(String, default="", index=True)
    owner_id: Mapped[str] = mapped_column(String, index=True)
    setter_id: Mapped[str] = mapped_column(String, default="")
    reviewer_id: Mapped[str] = mapped_column(String, default="")
    pillar: Mapped[str] = mapped_column(String, index=True)
    cadence: Mapped[str] = mapped_column(String, default="QUARTERLY")
    goal_type: Mapped[str] = mapped_column(String, default="OKR")
    measure: Mapped[str] = mapped_column(String)
    criteria: Mapped[str] = mapped_column(String, default="")
    weight: Mapped[int] = mapped_column(Integer, default=5)
    competencies: Mapped[list] = mapped_column(JSON, default=list)
    assignment_status: Mapped[str] = mapped_column(String, default="PENDING_ACCEPTANCE")
    employee_acceptance: Mapped[str] = mapped_column(String, default="PENDING")
    manager_acceptance: Mapped[str] = mapped_column(String, default="PENDING")
    partial_year: Mapped[bool] = mapped_column(Boolean, default=False)


class Participation(URFMixin, Base):
    __tablename__ = "tb_pm_participation"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_id)
    assignment_id: Mapped[str] = mapped_column(String, index=True)
    employee_id: Mapped[str] = mapped_column(String, index=True)
    role: Mapped[str] = mapped_column(String)  # OWNER | SETTER | REVIEWER


class AuditEntry(URFMixin, Base):
    __tablename__ = "tb_pm_audit_entry"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_id)
    assignment_id: Mapped[str] = mapped_column(String, index=True)
    actor: Mapped[str] = mapped_column(String, default="")
    action: Mapped[str] = mapped_column(String)
    detail: Mapped[str] = mapped_column(String, default="")
    at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class Employee(URFMixin, Base):
    """UAM STUB — this service SHALL NOT own identity per the pm-goal spec;
    URF UAM is supposed to supply employees, roles, and reporting lines. No
    real UAM exists in this environment, so this table stands in for it:
    resolving cascade targets and scoping who a manager may see, without a
    real org-hierarchy source. Replace with real UAM lookups when available.

    `id` is the employee's display-name string (e.g. "David Chen"), matching
    the convention already used everywhere else in this codebase (JWT `name`
    claim == ownerId/setterId/reviewerId/ratedBy) — not a real identity key,
    but required to stay consistent with existing data."""

    __tablename__ = "tb_pm_directory_employee"
    __table_args__ = (
        Index("ix_pm_directory_employee_manager", "manager_id"),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True)  # display name
    email: Mapped[str] = mapped_column(String, default="")
    role: Mapped[str] = mapped_column(String, default="employee")  # employee|manager|admin
    manager_id: Mapped[str] = mapped_column(String, default="", index=True)
    department: Mapped[str] = mapped_column(String, default="")
    country: Mapped[str] = mapped_column(String, default="IE")
    title: Mapped[str] = mapped_column(String, default="")


class UnlockRequest(URFMixin, Base):
    __tablename__ = "tb_pm_unlock_request"
    __table_args__ = (
        Index("ix_pm_unlock_request_period_status", "period_id", "status"),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_id)
    period_id: Mapped[str] = mapped_column(String, index=True)
    requested_by: Mapped[str] = mapped_column(String, default="")
    reason: Mapped[str] = mapped_column(String, default="")
    status: Mapped[str] = mapped_column(String, default="PENDING")
    decided_by: Mapped[str] = mapped_column(String, default="")
    decision_reason: Mapped[str] = mapped_column(String, default="")
    decided_at: Mapped[datetime] = mapped_column(DateTime, nullable=True)
