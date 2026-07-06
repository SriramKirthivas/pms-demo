"""pm-eval domain: append-only evaluations + continuous feedback."""

import uuid
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import DateTime, Boolean, Index, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column

from ..common.db import Base, URFMixin


def _id() -> str:
    return f"pmeval:{uuid.uuid4().hex}"


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class Evaluation(URFMixin, Base):
    """One rating check-in. Append-only — never overwritten."""

    __tablename__ = "tb_pm_evaluation"
    __table_args__ = (
        Index("ix_pm_evaluation_assignment_source_evaluated", "assignment_id", "source", "evaluated_at"),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_id)
    assignment_id: Mapped[str] = mapped_column(String, index=True)
    employee_id: Mapped[str] = mapped_column(String, index=True)  # the owner being rated
    period_id: Mapped[str] = mapped_column(String, default="", index=True)
    source: Mapped[str] = mapped_column(String)  # SELF | REVIEWER
    rated_by: Mapped[str] = mapped_column(String, default="")
    rating: Mapped[Decimal] = mapped_column(Numeric(3, 2))  # 1.00-5.00
    comment: Mapped[str] = mapped_column(String, default="")
    is_final: Mapped[bool] = mapped_column(Boolean, default=False)
    evaluated_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class ContinuousFeedback(URFMixin, Base):
    __tablename__ = "tb_pm_continuous_feedback"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_id)
    about_employee_id: Mapped[str] = mapped_column(String, index=True)
    from_user: Mapped[str] = mapped_column(String, default="")
    category: Mapped[str] = mapped_column(String, index=True)
    text: Mapped[str] = mapped_column(String, default="")
    fiscal_year: Mapped[str] = mapped_column(String, default="", index=True)
    at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class CheckInNote(URFMixin, Base):
    """Quarterly check-in note logged by a reviewer against an employee/period."""

    __tablename__ = "tb_pm_checkin_note"
    __table_args__ = (
        Index("ix_pm_checkin_note_employee_period", "employee_id", "period_id"),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_id)
    employee_id: Mapped[str] = mapped_column(String, index=True)
    period_id: Mapped[str] = mapped_column(String, index=True)
    author_id: Mapped[str] = mapped_column(String, default="")  # reviewer
    note: Mapped[str] = mapped_column(String, default="")
    fiscal_year: Mapped[str] = mapped_column(String, default="", index=True)
    at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class EvalAuditLog(URFMixin, Base):
    """Lightweight audit trail for period-level actions (e.g. reopen)."""

    __tablename__ = "tb_pm_eval_audit_log"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_id)
    period_id: Mapped[str] = mapped_column(String, index=True)
    action: Mapped[str] = mapped_column(String)
    detail: Mapped[str] = mapped_column(String, default="")
    at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class TenantOnboarding(URFMixin, Base):
    """Registry row marking that this service's schema/seed state has been
    provisioned for a tenant. Pure local DB bookkeeping — this service does
    NOT call out to any external Tenant Manager; onboarding here just means
    "this tenant's rows are recognized and its default settings exist"."""

    __tablename__ = "tb_pm_eval_tenant"

    tenant_id: Mapped[str] = mapped_column(String, primary_key=True)
    onboarded: Mapped[bool] = mapped_column(Boolean, default=False)
    # Stored as an ISO8601 string (empty = not yet onboarded) rather than a
    # nullable DateTime column, to avoid a SQLAlchemy 2.0.x / Python 3.13+
    # incompatibility resolving `Mapped[datetime | None]` union annotations
    # (see the identical latent issue on pm-goal's UnlockRequest.decided_at).
    onboarded_at: Mapped[str] = mapped_column(String, default="")
