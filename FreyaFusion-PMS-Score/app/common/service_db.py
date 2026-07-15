"""Per-service database helper. Each service owns one database, derived from the
base DATABASE_URL by swapping the database name (DB-per-service; physically
separable later by just changing DATABASE_URL).

    postgresql://u:p@host:5432/postgres  ->  .../<SERVICE_DB>
    sqlite:////tmp/x.db                   ->  .../<SERVICE_DB>.db   (tests)
"""

import os
import time

from sqlalchemy import create_engine, text


def base_url() -> str:
    url = os.getenv("DATABASE_URL", "postgresql://freya:freya@localhost:5432/postgres")
    if url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql://", 1)
    return url


def _shared_db() -> bool:
    """SHARED_DB=1 => all services use one managed DB (e.g. a single Render
    Postgres). Table names don't collide across services, so no per-service DB
    is created and DATABASE_URL is used verbatim."""
    return os.getenv("SHARED_DB", "").lower() in ("1", "true", "yes")


def service_url(db_name: str) -> str:
    base = base_url()
    if _shared_db():
        return base
    if base.startswith("sqlite"):
        if base.rstrip("/").endswith(".db"):
            return base.rsplit("/", 1)[0] + f"/{db_name}.db"
        return base
    return base.rsplit("/", 1)[0] + f"/{db_name}"


def ensure_database(db_name: str, retries: int = 12, delay: float = 2.0) -> None:
    base = base_url()
    if _shared_db() or base.startswith("sqlite"):
        return  # managed/single DB (Render) or sqlite — nothing to create
    admin_url = base.rsplit("/", 1)[0] + "/postgres"
    last: Exception | None = None
    for attempt in range(1, retries + 1):
        try:
            eng = create_engine(admin_url, isolation_level="AUTOCOMMIT")
            with eng.connect() as conn:
                exists = conn.execute(
                    text("SELECT 1 FROM pg_database WHERE datname = :n"), {"n": db_name}
                ).first()
                if not exists:
                    conn.execute(text(f'CREATE DATABASE "{db_name}"'))
            eng.dispose()
            return
        except Exception as err:  # noqa: BLE001
            last = err
            print(f"[service_db] {db_name} not ready ({attempt}/{retries}): {err}", flush=True)
            time.sleep(delay)
    raise RuntimeError(f"Could not ensure database {db_name}: {last}")
