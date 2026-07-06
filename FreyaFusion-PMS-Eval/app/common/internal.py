"""Internal service-to-service HTTP (httpx) + internal-endpoint guard.

Cross-service calls are BEST-EFFORT: a sibling being down must not break the
local operation (notifications are fire-and-forget; finalize is retried by the
platform). Base URLs come from env; when unset the call is skipped, which keeps
unit tests hermetic (no sibling required).

    GOAL_URL / EVAL_URL / SCORE_URL / NOTIFY_URL  -> sibling origins
    PM_GOAL_BASE_URL (etc.)                       -> explicit per-spec override, wins over *_URL
    INTERNAL_TOKEN                                -> shared secret for /system/*
    INTERNAL_ENFORCE=1                            -> require the token (prod)

Most cross-service reads/writes here are BEST-EFFORT (get_json/post_json,
emit_event) and swallow failures. A few are load-bearing preconditions
(e.g. verifying an assignment is ACTIVE before accepting a rating) — those
use get_json_strict, which raises InternalCallError instead.
"""

import os
import uuid

import httpx
from fastapi import Header, HTTPException

INTERNAL_TOKEN = os.getenv("INTERNAL_TOKEN", "dev-internal")
TIMEOUT = float(os.getenv("INTERNAL_TIMEOUT", "5"))


def _base(service: str) -> str:
    # PM_<SERVICE>_BASE_URL is accepted as an explicit override (used by
    # pm-eval for pm-goal calls per spec: PM_GOAL_BASE_URL); falls back to
    # the shared <SERVICE>_URL convention used across the other PM services.
    explicit = os.getenv(f"PM_{service.upper()}_BASE_URL", "")
    if explicit:
        return explicit.rstrip("/")
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


class InternalCallError(Exception):
    """Raised by get_json_strict when a REQUIRED cross-service call fails.

    Unlike get_json/post_json (best-effort — used for notifications and
    fire-and-forget events where a down sibling must not break the local
    operation), some calls are load-bearing preconditions (e.g. verifying an
    assignment is ACTIVE/unlocked before accepting a rating). For those, a
    missing base URL, timeout, or non-2xx response must be treated as a hard
    failure by the caller rather than silently proceeding.
    """


def get_json_strict(service: str, path: str, params: dict | None = None):
    """Like get_json, but raises InternalCallError instead of swallowing
    failures. Use for pre-conditions that must not silently pass when the
    sibling service is unreachable or misconfigured."""
    base = _base(service)
    if not base:
        raise InternalCallError(f"{service} base URL is not configured")
    try:
        r = httpx.get(base + path, params=params, headers=_headers(), timeout=TIMEOUT)
        r.raise_for_status()
    except Exception as err:  # noqa: BLE001
        raise InternalCallError(f"{service} call to {path} failed: {err}") from err
    return r.json().get("data")


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
