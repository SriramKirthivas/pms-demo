"""YAML config profile + AWS Secrets Manager resolution (the platform's
`enable-aws-secrets` pattern, adapted for Python/FastAPI).

When APP_ENV is set (e.g. APP_ENV=dev — the analogue of SPRING_PROFILES_ACTIVE),
`config/{APP_ENV}.yml` is loaded. That file holds NON-secret config plus the
NAMES of Secrets Manager secrets. Secret VALUES are then fetched from Secrets
Manager and placed into the environment — so nothing sensitive is ever an env
var or committed.

Resolution rules:
  * Real environment variables always win (values applied with setdefault).
  * From the YAML: non-secret keys are injected directly.
  * If ENABLE_AWS_SECRETS is true and secret NAMES are given, fetch:
      - APP_SECRET_NAME  -> JSON {SECRET_KEY, INTERNAL_TOKEN}  (app secret)
      - DB_SECRET_NAME   -> RDS JSON {username,password,host,port[,dbname]}
                            assembled into DATABASE_URL
  * If APP_ENV is unset (local dev, tests), this is a complete no-op.

Call load_config() once at startup before config-reading modules import.
"""

import json
import os
import pathlib

# These only ever come from Secrets Manager / the environment — never the file.
_SECRET_KEYS = {"DATABASE_URL", "SECRET_KEY", "INTERNAL_TOKEN", "SMTP_PASSWORD"}


def load_config() -> None:
    env = os.getenv("APP_ENV")
    if not env:
        return
    try:
        import yaml
    except ImportError:
        return
    path = pathlib.Path(__file__).resolve().parents[2] / "config" / f"{env}.yml"
    if not path.is_file():
        return
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    for key, value in data.items():
        if key in _SECRET_KEYS or value is None:
            continue
        os.environ.setdefault(str(key), str(value))
    _resolve_aws_secrets()


def _resolve_aws_secrets() -> None:
    """Fetch secret values from Secrets Manager using the names configured in the
    YAML (DB_SECRET_NAME, APP_SECRET_NAME). Best-effort; existing env vars win."""
    if os.getenv("ENABLE_AWS_SECRETS", "false").lower() not in ("1", "true", "yes"):
        return
    db_secret = os.getenv("DB_SECRET_NAME")
    app_secret = os.getenv("APP_SECRET_NAME")
    if not (db_secret or app_secret):
        return
    try:
        import boto3
    except ImportError:
        return
    client = boto3.client("secretsmanager", region_name=os.getenv("AWS_REGION", "us-east-1"))

    def _fetch(name: str) -> dict:
        try:
            return json.loads(client.get_secret_value(SecretId=name)["SecretString"])
        except Exception:  # noqa: BLE001 — best-effort; app falls back to env/defaults
            return {}

    # App secret -> SECRET_KEY / INTERNAL_TOKEN
    if app_secret and not (os.getenv("SECRET_KEY") and os.getenv("INTERNAL_TOKEN")):
        d = _fetch(app_secret)
        for k in ("SECRET_KEY", "INTERNAL_TOKEN"):
            if d.get(k):
                os.environ.setdefault(k, str(d[k]))

    # DB secret (RDS format) -> DATABASE_URL
    if db_secret and not os.getenv("DATABASE_URL"):
        from urllib.parse import quote

        d = _fetch(db_secret)
        if d.get("host"):
            user = quote(str(d.get("username", "")), safe="")
            pwd = quote(str(d.get("password", "")), safe="")
            host = d["host"]
            port = d.get("port", 5432)
            name = d.get("dbname") or "postgres"
            cred = f"{user}:{pwd}@" if user else ""
            os.environ.setdefault("DATABASE_URL", f"postgresql://{cred}{host}:{port}/{name}")
