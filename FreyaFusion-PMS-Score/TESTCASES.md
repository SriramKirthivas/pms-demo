# Test Cases — FreyaFusion-PMS-Score

**Service:** Scoring & Talent (`pm-score`) · context path `/api/pm-score`

## How to execute
**Automated:** `pip install -r requirements.txt && python -m pytest -q`
**Manual:** boot with `uvicorn app.main:app --port 8000`; mint JWTs (admin / manager / employee).

A full-weight `sections` payload (weights total 100) with every score = 4 gives Final IPF = **4.0**:
```json
{"employeeId":"David Chen","fiscalYear":"FY26-27","sections":[
  {"ipfWeight":10,"selfScore":4,"managerScore":4},{"ipfWeight":5,"selfScore":4,"managerScore":4},
  {"ipfWeight":10,"selfScore":4,"managerScore":4},{"ipfWeight":5,"selfScore":4,"managerScore":4},
  {"ipfWeight":10,"selfScore":4,"managerScore":4},{"ipfWeight":5,"selfScore":4,"managerScore":4},
  {"ipfWeight":10,"selfScore":4,"managerScore":4},{"ipfWeight":5,"selfScore":4,"managerScore":4},
  {"ipfWeight":20,"selfScore":4,"managerScore":4},{"ipfWeight":20,"selfScore":4,"managerScore":4}]}
```

## Cases

| ID | Title | Precondition | Steps | Expected |
|---|---|---|---|---|
| TC-S-01 | Health check | Service up | `GET /api/health` | 200, `service = pm-score` |
| TC-S-02 | List performance bands | — | `GET /api/pm-score/bands` | includes Exceptional / Exceeds / Meets / Needs Improvement / Unsatisfactory + suggested actions |
| TC-S-03 | Compute Final IPF + band | — | admin `POST /scorecards/compute` (payload above) | `managerFinalIPF = 4.0`, `bandManager = "Exceeds Expectations"` |
| TC-S-04 | 9-box performance auto-set | TC-S-03 | inspect response `nineBox` | `performanceLevel = 3` (IPF ≥ 3.8) |
| TC-S-05 | Compute is manager-only | — | **employee** `POST /scorecards/compute` | 403 |
| TC-S-06 | Get scorecard | TC-S-03 | `GET /scorecards?employeeId=David Chen&fiscalYear=FY26-27` | returns stored scorecard + band + nineBox |
| TC-S-07 | 9-box placement (set potential) | Scorecard exists | manager `POST /nine-box/place {employeeId, fiscalYear, potentialLevel:3}` | `performanceLevel=3, potentialLevel=3, boxLabel="Star"` |
| TC-S-08 | Sign-off blocked before acknowledge | Scorecard DRAFT | admin `POST /scorecards/{id}/signoff` | 409, CONFLICT |
| TC-S-09 | Acknowledge is employee-only | Scorecard DRAFT | **manager** `POST /scorecards/{id}/acknowledge` | 403 |
| TC-S-10 | Employee acknowledges | Scorecard DRAFT | employee `POST /scorecards/{id}/acknowledge` | `state = ACKNOWLEDGED` |
| TC-S-11 | HRBP sign-off | Scorecard ACKNOWLEDGED | admin `POST /scorecards/{id}/signoff` | `state = SIGNED_OFF` |
| TC-S-12 | Signed-off is immutable | Scorecard SIGNED_OFF | admin `POST /scorecards/compute` again | 409, CONFLICT (no silent recompute) |

_Band boundaries: 4.5+ Exceptional · 3.8–4.4 Exceeds · 2.9–3.7 Meets · 2.1–2.8 Needs Improvement · 1.0–2.0 Unsatisfactory (boundary → higher band)._
_Automated coverage: `tests/test_score.py`._
