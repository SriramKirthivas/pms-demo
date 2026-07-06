# Test Cases — FreyaFusion-PMS-Dashboard (Frontend)

**App:** React + Vite SPA. These are **manual UI test cases** (browser).

## How to execute
```bash
npm install
# point at a running gateway/ALB (or the backends behind it)
VITE_API_URL=http://localhost:8000/api npm run dev   # open http://localhost:5173
```
The backend services (Goal / Eval / Score / Notify) must be reachable via `VITE_API_URL`
for data-driven screens. Sign in with a demo account:
admin `n.patel@company.com` · manager `s.mitchell@company.com` · employee `d.chen@company.com` (password `demo1234`).

## Cases

| ID | Title | Steps | Expected |
|---|---|---|---|
| TC-D-01 | App builds | `npm run build` (or `docker build .`) | Build succeeds, `dist/` produced |
| TC-D-02 | App loads | Open the app URL | Login page renders, no console errors |
| TC-D-03 | Sign in | Pick a demo account → Sign in | Lands on Dashboard; sidebar visible |
| TC-D-04 | Role-based nav | Sign in as employee vs admin | Admin sees Team Settings / Config; employee does not |
| TC-D-05 | Dashboard screen | Open Dashboard | Personal IPF, goals, engagement tiles render |
| TC-D-06 | Goals — Goal Sheet tab | Goals & Cascade → "Goal Sheet" tab | OKR/KPI sheet with self/manager ratings renders |
| TC-D-07 | Goals — Lifecycle tab | Goals & Cascade → "Lifecycle" tab | Framework, goal authoring, cascade, assignments panels render |
| TC-D-08 | Lifecycle: configure framework (admin) | As admin, Lifecycle → Configure → set cadences + 60/40 → Save | Periods Q1–Q4 + Annual appear |
| TC-D-09 | Lifecycle: cascade + accept | Author goals to weight 10 → Cascade to David Chen → sign in as employee → Accept | Assignment moves PENDING → ACTIVE after both accept |
| TC-D-10 | Talent Matrix | Open Talent Matrix (manager/admin) | 9-box grid renders |
| TC-D-11 | Scorecard | Open Scorecard | IPF breakdown (60/40), band render |
| TC-D-12 | Notifications bell | Click the bell (header) | Notification list/empty-state renders; count badge if any |
| TC-D-13 | Sign out | Profile/menu → Sign out | Returns to login |

> Note: screens that read data (Dashboard, Talent, Scorecard) require the corresponding
> backend service to be up. If a service is down, that screen shows empty/loading — not a crash.
