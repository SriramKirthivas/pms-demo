import os
import tempfile

os.environ["DATABASE_URL"] = f"sqlite:///{tempfile.gettempdir()}/pm_score_base.db"
os.environ["SERVICE_DB"] = "pm_score_test"
os.environ["SECRET_KEY"] = "test-secret"

import jwt  # noqa: E402
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.common import db as dbmod  # noqa: E402
from app.main import app  # noqa: E402


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
