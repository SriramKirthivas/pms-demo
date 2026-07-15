"""This service's own database (SQLAlchemy engine + URF base columns).

DB name comes from SERVICE_DB (set per service in the Dockerfile). main.py
imports the domain models (registering them on Base) and then calls init().
"""

import os
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, String, create_engine, inspect, text
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
    _sync_columns()


def _sync_columns() -> None:
    """Additive auto-migration: add any mapped columns that are missing from an
    already-existing table. create_all() only CREATES new tables — it never
    ALTERs an existing one, so a newly-added column on a pre-existing table
    would otherwise raise UndefinedColumn at query time (the classic symptom
    after a model change against a managed DB that can't be dropped/recreated).

    This adds only *missing* columns (idempotent; never drops or retypes) and
    is best-effort — a failure here logs and is swallowed so it can never block
    startup. On a fresh DB (tests, first boot) create_all already made every
    column, so nothing runs.
    """
    try:
        insp = inspect(_engine)
        table_names = set(insp.get_table_names())
        pending = []  # (table, column) still missing from the live schema
        for table in Base.metadata.sorted_tables:
            if table.name not in table_names:
                continue  # create_all just made it — already current
            existing = {c["name"] for c in insp.get_columns(table.name)}
            for col in table.columns:
                if col.name not in existing:
                    pending.append((table, col))
        if not pending:
            return
        with _engine.begin() as conn:
            for table, col in pending:
                coltype = col.type.compile(dialect=_engine.dialect)
                ddl = f'ALTER TABLE "{table.name}" ADD COLUMN IF NOT EXISTS "{col.name}" {coltype}'
                # Carry a scalar column default so existing rows get a value
                # (Postgres backfills on ADD COLUMN ... DEFAULT). Callable
                # defaults (e.g. timestamps) are left to apply on new inserts.
                arg = getattr(col.default, "arg", None)
                if arg is not None and not callable(arg):
                    if isinstance(arg, bool):
                        ddl += f" DEFAULT {'true' if arg else 'false'}"
                    elif isinstance(arg, (int, float)):
                        ddl += f" DEFAULT {arg}"
                    else:
                        ddl += " DEFAULT '" + str(arg).replace("'", "''") + "'"
                conn.execute(text(ddl))
                print(f"[db] added missing column {table.name}.{col.name}", flush=True)
    except Exception as err:  # noqa: BLE001 — best-effort; must not block startup
        print(f"[db] column sync skipped: {err}", flush=True)


def get_session():
    if _Session is None:
        init()
    db = _Session()
    try:
        yield db
    finally:
        db.close()
