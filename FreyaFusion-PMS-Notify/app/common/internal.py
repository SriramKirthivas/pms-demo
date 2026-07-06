"""Internal service-to-service HTTP (httpx) + internal-endpoint guard.

Cross-service calls are BEST-EFFORT: a sibling being down must not break the
local operation (notifications are fire-and-forget; finalize is retried by the
platform). Base URLs come from env; when unset the call is skipped, which keeps
unit tests hermetic (no sibling required).

    GOAL_URL / EVAL_URL / SCORE_URL / NOTIFY_URL  -> sibling origins
    INTERNAL_TOKEN                                -> shared secret for /system/*
    INTERNAL_ENFORCE=1                            -> require the token (prod)
"""

import os
import uuid

import httpx
from fastapi import Header, HTTPException

INTERNAL_TOKEN = os.getenv("INTERNAL_TOKEN", "dev-internal")
TIMEOUT = float(os.getenv("INTERNAL_TIMEOUT", "5"))


def _base(service: str) -> str:
    return os.getenv(f"{service.upper()}_URL", "").rstrip("/")


def _headers() -> dict:
    return {"X-Internal-Token": INTERNAL_TOKEN}


def require_internal(x_internal_token: str = Header(default="")) -> bool:
    """Guard for /system/* endpoints. Enforced only when INTERNAL_ENFORCE=1."""
    if os.getenv("INTERNAL_ENFORCE", "0") == "1" and x_internal_token != INTERNAL_TOKEN:
        raise HTTPException(status_code=401, detail="internal token required")
    return True


def get_json(service: str, path: str, params: dict | None = None):
    base = _base(service)
    if not base:
        return None
    try:
        r = httpx.get(base + path, params=params, headers=_headers(), timeout=TIMEOUT)
        r.raise_for_status()
        return r.json().get("data")
    except Exception:  # noqa: BLE001 — best-effort
        return None


def post_json(service: str, path: str, json: dict):
    base = _base(service)
    if not base:
        return None
    try:
        r = httpx.post(base + path, json=json, headers=_headers(), timeout=TIMEOUT)
        r.raise_for_status()
        return r.json().get("data")
    except Exception:  # noqa: BLE001 — best-effort
        return None


def emit_event(type_: str, recipient_id: str, title: str, body: str = "", href: str = "") -> None:
    """Fire a domain event to pm-notify (best-effort, idempotent by eventId)."""
    if not recipient_id:
        return
    post_json("notify", "/api/pm-notify/system/events", {
        "eventId": f"evt:{uuid.uuid4().hex}",
        "type": type_, "recipientId": recipient_id,
        "title": title, "body": body, "href": href,
    })
