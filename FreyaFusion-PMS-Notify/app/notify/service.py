"""pm-notify logic: ingest events (idempotent) + per-user read state."""

import logging

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..common.auth import CurrentUser
from ..common.envelope import NOT_FOUND, PARAM_INVALID, FORBIDDEN, ApiError
from . import schemas
from .email import send_email
from .models import EventDedupe, Notification, NotificationPreference

logger = logging.getLogger("pm_notify.service")


def _claim_event(db: Session, event_id: str) -> bool:
    """Insert into the dedupe table if not already present.

    Returns True if this call claimed the event (i.e. it's new and should be
    processed), False if it was already processed (redelivery -> no-op).
    """
    if not event_id:
        # No event id supplied -> nothing to dedupe against, always "new".
        return True
    existing = db.query(EventDedupe).filter_by(event_id=event_id).first()
    if existing:
        return False
    dedupe = EventDedupe(event_id=event_id)
    db.add(dedupe)
    try:
        db.commit()
    except IntegrityError:
        # Lost a race with a concurrent claim of the same event id.
        db.rollback()
        return False
    return True


def _email_eligible(db: Session, employee_id: str, event_type: str) -> bool:
    if event_type not in schemas.EMAIL_ELIGIBLE_EVENTS:
        return False
    pref = (
        db.query(NotificationPreference)
        .filter_by(employee_id=employee_id, event_type=event_type)
        .first()
    )
    if pref is None:
        return True  # default enabled when no explicit preference row
    return pref.email_enabled


def process_event(db: Session, ev: schemas.EventIn) -> Notification | None:
    """Shared event-processing pipeline used by both the HTTP fallback
    (POST /system/events) and the SQS consumer, so both paths share
    identical validation, idempotency, and delivery logic.
    """
    if ev.type not in schemas.EVENT_TYPES:
        raise ApiError(400, PARAM_INVALID, f"unknown event type {ev.type}")

    if not _claim_event(db, ev.eventId):
        logger.info("event %s already processed; skipping duplicate", ev.eventId)
        # Idempotency source of truth says this was already handled — return
        # the existing notification (if any) for display/traceability.
        existing = db.query(Notification).filter_by(event_id=ev.eventId, is_delete=False).first()
        return existing

    n = Notification(
        recipient_id=ev.recipientId, type=ev.type, title=ev.title,
        body=ev.body, href=ev.href, event_id=ev.eventId, read_state=False,
    )
    db.add(n)
    db.commit()
    db.refresh(n)

    if _email_eligible(db, ev.recipientId, ev.type):
        send_email(ev.recipientId, ev.title or ev.type, ev.body or "")

    return n


# Backward-compatible alias (kept for any existing callers/tests).
def ingest_event(db: Session, ev: schemas.EventIn) -> Notification | None:
    return process_event(db, ev)


def list_for(db: Session, recipient: str, status: str | None = None) -> list[Notification]:
    q = db.query(Notification).filter_by(recipient_id=recipient, is_delete=False)
    if status == "unread":
        q = q.filter_by(read_state=False)
    elif status == "read":
        q = q.filter_by(read_state=True)
    return q.order_by(Notification.at.desc()).all()


def list_page_for(
    db: Session, recipient: str, status: str | None = None,
    page_num: int = 1, page_size: int = 20,
) -> tuple[list[Notification], int]:
    """Return (page_of_notifications, total_count) for the recipient."""
    page_num = max(1, page_num)
    page_size = max(1, page_size)
    q = db.query(Notification).filter_by(recipient_id=recipient, is_delete=False)
    if status == "unread":
        q = q.filter_by(read_state=False)
    elif status == "read":
        q = q.filter_by(read_state=True)
    total = q.count()
    rows = (
        q.order_by(Notification.at.desc())
        .offset((page_num - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return rows, total


def unread_count(db: Session, recipient: str) -> int:
    return db.query(Notification).filter_by(recipient_id=recipient, read_state=False, is_delete=False).count()


def mark_read(db: Session, notif_id: str, user: CurrentUser) -> Notification:
    n = db.query(Notification).filter_by(id=notif_id, is_delete=False).first()
    if not n:
        raise ApiError(404, NOT_FOUND, "Notification not found")
    if n.recipient_id != user.name:
        raise ApiError(403, FORBIDDEN, "You can only read your own notifications")
    n.read_state = True
    db.commit()
    db.refresh(n)
    return n


def mark_all_read(db: Session, user: CurrentUser) -> int:
    rows = db.query(Notification).filter_by(recipient_id=user.name, read_state=False, is_delete=False).all()
    for n in rows:
        n.read_state = True
    db.commit()
    return len(rows)


def out(n: Notification) -> dict:
    return {
        "id": n.id, "recipientId": n.recipient_id, "type": n.type,
        "title": n.title, "body": n.body, "href": n.href,
        "read": n.read_state, "at": n.at.isoformat() + "Z",
    }


# --- Preferences ---------------------------------------------------------

def get_preferences(db: Session, employee_id: str) -> dict[str, bool]:
    """Preference for every catalog event type, defaulting to enabled."""
    rows = db.query(NotificationPreference).filter_by(employee_id=employee_id).all()
    overrides = {r.event_type: r.email_enabled for r in rows}
    return {et: overrides.get(et, True) for et in sorted(schemas.EVENT_TYPES)}


def update_preferences(db: Session, employee_id: str, updates: list[schemas.PreferenceUpdate]) -> dict[str, bool]:
    for upd in updates:
        if upd.eventType not in schemas.EVENT_TYPES:
            raise ApiError(400, PARAM_INVALID, f"unknown event type {upd.eventType}")
        row = (
            db.query(NotificationPreference)
            .filter_by(employee_id=employee_id, event_type=upd.eventType)
            .first()
        )
        if row:
            row.email_enabled = upd.emailEnabled
        else:
            db.add(NotificationPreference(
                employee_id=employee_id, event_type=upd.eventType, email_enabled=upd.emailEnabled,
            ))
    db.commit()
    return get_preferences(db, employee_id)
