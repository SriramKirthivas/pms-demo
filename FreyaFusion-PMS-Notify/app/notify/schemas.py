from pydantic import BaseModel

# Event types emitted by the other PM services (spec catalog).
EVENT_TYPES = {
    "GOAL_CASCADED", "CHANGE_REQUESTED", "ASSIGNMENT_ACCEPTED", "ASSIGNMENT_ACTIVE",
    "PERIOD_LOCKED", "UNLOCK_REQUESTED", "UNLOCK_DECISION", "RATING_SUBMITTED",
    "FEEDBACK_RECEIVED", "SCORECARD_PUBLISHED", "SCORECARD_ACKNOWLEDGED",
    "SCORECARD_SIGNED_OFF",
    # Early-completion flow (owner requests, manager approves/rejects).
    "COMPLETION_REQUESTED", "COMPLETION_APPROVED", "COMPLETION_REJECTED",
    # Admin opens the performance cycle — push-out notice to all participants.
    "CYCLE_OPENED",
}

# Event types that additionally trigger an email (subject to per-user preference).
EMAIL_ELIGIBLE_EVENTS = {
    "SCORECARD_PUBLISHED", "SCORECARD_SIGNED_OFF", "PERIOD_LOCKED",
    "UNLOCK_REQUESTED", "UNLOCK_DECISION", "CYCLE_OPENED",
}


class EventIn(BaseModel):
    eventId: str            # for idempotent processing
    type: str
    recipientId: str
    title: str
    body: str = ""
    href: str = ""


class PreferenceUpdate(BaseModel):
    eventType: str
    emailEnabled: bool


class PreferencesIn(BaseModel):
    preferences: list[PreferenceUpdate]
