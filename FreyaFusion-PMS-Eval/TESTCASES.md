# Test Cases — FreyaFusion-PMS-Eval

**Service:** Evaluation & Feedback (`pm-eval`) · context path `/api/pm-eval`

## How to execute
**Automated:** `pip install -r requirements.txt && python -m pytest -q`
**Manual:** boot with `uvicorn app.main:app --port 8000`; mint JWTs as in the Goal repo's
TESTCASES (admin / manager / employee).

## Cases

| ID | Title | Precondition | Steps | Expected |
|---|---|---|---|---|
| TC-E-01 | Health check | Service up | `GET /api/health` | 200, `service = pm-eval` |
| TC-E-02 | Self-rating is append-only | — | employee `POST /evaluations/self {assignmentId:"a1", employeeId:"David Chen", rating:3.5}` then again `rating:4.25` | both stored; history has 2 rows (nothing overwritten) |
| TC-E-03 | Reviewer rating (manager) | — | manager `POST /evaluations/reviewer {assignmentId:"a1", employeeId:"David Chen", rating:4.0}` | 200; stored with `source = REVIEWER` |
| TC-E-04 | Current = latest per source | TC-E-02 + TC-E-03 done | `GET /evaluations/current?assignmentId=a1` | `self.rating = 4.25`, `reviewer.rating = 4.0` |
| TC-E-05 | History returns full ordered list | Several evaluations | `GET /evaluations?assignmentId=a1` | all evaluations, ordered by time, flagged by source |
| TC-E-06 | Reviewer rating is manager-only | — | **employee** `POST /evaluations/reviewer` | 403 |
| TC-E-07 | Reviewer cannot rate own assignment | — | manager posts reviewer rating with `employeeId` = own name | 403 |
| TC-E-08 | Rating below range rejected | — | `POST /evaluations/self rating:0` | 400, `code = PARAM_INVALID` |
| TC-E-09 | Rating above range rejected | — | `POST /evaluations/self rating:5.5` | 400, `PARAM_INVALID` |
| TC-E-10 | Log continuous feedback | — | manager `POST /feedback {aboutEmployeeId:"David Chen", category:"STRETCH", text:"Ready for more scope"}` | 200; `category = STRETCH` |
| TC-E-11 | Invalid feedback category rejected | — | `POST /feedback category:"NOPE"` | 400, PARAM_INVALID |
| TC-E-12 | List feedback by employee + category | TC-E-10 done | `GET /feedback?aboutEmployeeId=David Chen&category=STRETCH` | returns the STRETCH entry |
| TC-E-13 | My authored feedback | Author left feedback | `GET /feedback/mine` | returns entries authored by the caller |

_Valid categories: MOTIVATION, COMMUNICATION, ATTITUDE, STRETCH, IMPROVEMENT, GENERAL._
_Automated coverage: `tests/test_eval.py`._
