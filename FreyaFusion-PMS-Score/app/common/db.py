"""This service's own database (SQLAlchemy engine + URF base columns).

DB name comes from SERVICE_DB (set per service in the Dockerfile). main.py
imports the domain models (registering them on Base) and then calls init().
"""

import os
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, String, create_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker

from .service_db import ensure_database, service_url

DB_NAME = os.getenv("SERVICE_DB", "pm_service")

_engine = None
_Session = None


class Base(DeclarativeBase):
    pass


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class URFMixin:
    """URF standard columns carried by every table."""

    tenant_id: Mapped[str] = mapped_column(String, default="default", index=True)
    create_time: Mapped[datetime] = mapped_column(DateTime, default=_now)
    update_time: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)
    create_user: Mapped[str] = mapped_column(String, default="")
    update_user: Mapped[str] = mapped_column(String, default="")
    is_delete: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    status: Mapped[str] = mapped_column(String, default="ACTIVE")


def init() -> None:
    """Ensure the database exists and create the tables (models already imported)."""
    global _engine, _Session
    if _engine is None:
        ensure_database(DB_NAME)
        _engine = create_engine(service_url(DB_NAME), pool_pre_ping=True)
        _Session = sessionmaker(bind=_engine, expire_on_commit=False)
    Base.metadata.create_all(_engine)


def get_session():
    if _Session is None:
        init()
    db = _Session()
    try:
        yield db
    finally:
        db.close()
