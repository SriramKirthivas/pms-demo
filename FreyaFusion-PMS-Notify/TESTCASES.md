# Test Cases — FreyaFusion-PMS-Notify

**Service:** Notifications (`pm-notify`) · context path `/api/pm-notify`

## How to execute
**Automated:** `pip install -r requirements.txt && python -m pytest -q`
**Manual:** boot with `uvicorn app.main:app --port 8000`; mint JWTs (manager / employee).
Events are posted (no token) to `POST /api/pm-notify/system/events` — this simulates
another service emitting a domain event (via SQS in production).

## Cases

| ID | Title | Precondition | Steps | Expected |
|---|---|---|---|---|
| TC-N-01 | Health check | Service up | `GET /api/health` | 200, `service = pm-notify` |
| TC-N-02 | Event creates a notification | — | `POST /system/events {eventId:"e1", type:"GOAL_CASCADED", recipientId:"David Chen", title:"Goal to accept"}` | 200; then employee `GET /notifications` shows 1 item, `type = GOAL_CASCADED` |
| TC-N-03 | Idempotent by event id | TC-N-02 done | POST the **same** `eventId:"e1"` again | still only 1 notification (no duplicate) |
| TC-N-04 | Unknown event type rejected | — | `POST /system/events type:"NONSENSE"` | 400, PARAM_INVALID |
| TC-N-05 | Recipient scoping | Notification for David Chen exists | **manager** `GET /notifications` | returns empty (sees only own) |
| TC-N-06 | Unread count | 2 notifications for David Chen | employee `GET /notifications/unread-count` | `unread = 2` |
| TC-N-07 | Mark one read | TC-N-06 | employee `POST /notifications/{id}/read`, then unread-count | `unread = 1` |
| TC-N-08 | Mark all read | Unread > 0 | employee `POST /notifications/read-all`, then unread-count | `unread = 0` |
| TC-N-09 | Cannot read another's notification | Notification belongs to David Chen | **manager** `POST /notifications/{id}/read` | 403 |

_Event catalog: GOAL_CASCADED, CHANGE_REQUESTED, ASSIGNMENT_ACTIVE, PERIOD_LOCKED,
UNLOCK_REQUESTED, UNLOCK_DECISION, RATING_SUBMITTED, FEEDBACK_RECEIVED,
SCORECARD_PUBLISHED, SCORECARD_ACKNOWLEDGED, SCORECARD_SIGNED_OFF._
_Automated coverage: `tests/test_notify.py`._
