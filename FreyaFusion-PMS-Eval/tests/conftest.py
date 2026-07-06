import os
import tempfile

os.environ["DATABASE_URL"] = f"sqlite:///{tempfile.gettempdir()}/pm_eval_base.db"
os.environ["SERVICE_DB"] = "pm_eval_test"
os.environ["SECRET_KEY"] = "test-secret"

import jwt  # noqa: E402
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.common import db as dbmod  # noqa: E402
from app.eval import service as eval_service  # noqa: E402
from app.main import app  # noqa: E402


def default_assignment(assignment_id: str = "asg-1") -> dict:
    """Shape returned by pm-goal's GET /system/assignments/{id} per spec."""
    return {
        "id": assignment_id, "status": "ACTIVE", "ownerId": "David Chen",
        "reviewerIds": ["Sarah Mitchell"], "periodId": "P1", "periodLocked": False,
    }


@pytest.fixture(autouse=True)
def mock_pm_goal(monkeypatch):
    """Hermetic default: pretend every assignment is ACTIVE/unlocked so
    existing evaluation tests (written before the pm-goal precondition
    existed) keep working without a live pm-goal. This patches the LOWEST
    level (fetch_assignment, the raw pm-goal call), not verify_assignment_active
    itself, so individual tests remain free to monkeypatch either function
    (fetch_assignment for "pm-goal returned X" scenarios, or
    verify_assignment_active directly for "the whole check raises Y")
    without one patch clobbering the other."""

    def _fake_fetch(assignment_id: str) -> dict:
        return default_assignment(assignment_id)

    monkeypatch.setattr(eval_service, "fetch_assignment", _fake_fetch)
    yield


@pytest.fixture
def client():
    dbmod.init()
    dbmod.Base.metadata.drop_all(dbmod._engine)
    dbmod.Base.metadata.create_all(dbmod._engine)
    return TestClient(app)


def token(role: str, name: str) -> str:
    return jwt.encode({"sub": "t@x.com", "name": name, "role": role, "country": "IE"},
                      "test-secret", algorithm="HS256")


def auth(t: str) -> dict:
    return {"Authorization": f"Bearer {t}"}
