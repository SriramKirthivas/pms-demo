"""pm-notify domain: notification records + delivery/read state."""

import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from ..common.db import Base, URFMixin


def _id() -> str:
    return f"pmnotify:{uuid.uuid4().hex}"


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class Notification(URFMixin, Base):
    __tablename__ = "tb_pm_notification"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_id)
    recipient_id: Mapped[str] = mapped_column(String, index=True)
    type: Mapped[str] = mapped_column(String)  # GOAL_CASCADED, UNLOCK_REQUESTED, ...
    title: Mapped[str] = mapped_column(String, default="")
    body: Mapped[str] = mapped_column(String, default="")
    href: Mapped[str] = mapped_column(String, default="")
    read_state: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    event_id: Mapped[str] = mapped_column(String, default="", index=True)  # for display/traceability
    at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class EventDedupe(URFMixin, Base):
    """Idempotency source of truth for inbound events (SQS + HTTP fallback)."""

    __tablename__ = "tb_pm_event_dedupe"
    __table_args__ = (UniqueConstraint("event_id", name="uq_pm_event_dedupe_event_id"),)

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_id)
    event_id: Mapped[str] = mapped_column(String, index=True, unique=True)
    processed_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class NotificationPreference(URFMixin, Base):
    """Per-user, per-event-type email delivery preference."""

    __tablename__ = "tb_pm_notification_preference"
    __table_args__ = (
        UniqueConstraint("employee_id", "event_type", name="uq_pm_notification_pref_emp_type"),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_id)
    employee_id: Mapped[str] = mapped_column(String, index=True)
    event_type: Mapped[str] = mapped_column(String)
    email_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
