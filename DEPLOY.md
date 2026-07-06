# Deploying the FreyaFusion PMS demo (Render + Vercel)

Five apps ship: **4 FastAPI services + 1 legacy `/api` shim → Render**, and the
**React dashboard → Vercel**. All four pm-* services share **one free Postgres**
(their tables are uniquely prefixed, so there are no collisions). Login works in
the browser (no auth server needed — `src/lib/devAuth.ts` mints the JWT).

Everything is pre-wired in `render.yaml`. You only need three accounts:
**GitHub**, **Render**, **Vercel** (all free).

---

## Step 1 — Push to GitHub

From `PMS-ADO/` (already a git repo with a first commit):

```bash
# create an EMPTY repo on github.com first (no README), then:
git remote add origin https://github.com/<you>/pms-demo.git
git branch -M main
git push -u origin main
```

## Step 2 — Render (backends + database)

1. Render Dashboard → **New +** → **Blueprint**.
2. Connect the GitHub repo. Render finds `render.yaml` and shows 5 services + 1
   database. Click **Apply**.
3. Wait for the first build (~5–8 min). When done, each service has a public URL:
   `https://pms-goal-XXXX.onrender.com` (Render appends a random suffix).
4. **Copy the 5 URLs** — you need the pm-* four + the shim for Step 3.

Health check for each: open `<url>/api/health` → `{"status":"ok",...}`.

> The Blueprint sets `SECRET_KEY=dev-secret` (must match the frontend),
> `DB_AUTOCREATE=0`, `SERVICE_DB=pms`, and wires `DATABASE_URL` to the shared
> Postgres automatically.

## Step 3 — Vercel (frontend)

1. Vercel → **Add New** → **Project** → import the same repo.
2. **Root Directory:** `FreyaFusion-PMS-Dashboard`  (Framework preset: **Vite**,
   auto-detected). Build `npm run build`, output `dist` — leave as detected.
3. **Environment Variables** (Production) — paste your real Render URLs, each
   **including its context path**:

   | Name | Value |
   |------|-------|
   | `VITE_PM_GOAL_URL`   | `https://pms-goal-XXXX.onrender.com/api/pm-goal` |
   | `VITE_PM_EVAL_URL`   | `https://pms-eval-XXXX.onrender.com/api/pm-eval` |
   | `VITE_PM_SCORE_URL`  | `https://pms-score-XXXX.onrender.com/api/pm-score` |
   | `VITE_PM_NOTIFY_URL` | `https://pms-notify-XXXX.onrender.com/api/pm-notify` |
   | `VITE_API_URL`       | `https://pms-legacy-shim-XXXX.onrender.com/api` |
   | `VITE_DEV_LOGIN`     | `1` |

   Leave `VITE_DEV_JWT_SECRET` unset (defaults to `dev-secret`, matching Render).
4. **Deploy.** Open the Vercel URL → login screen → pick a persona → password
   `demo1234`.

## Step 4 — Seed demo data (once, after Render is up)

The databases start empty. Run the seeder against your live Render URLs:

```bash
# from PMS-ADO/ , with the venv that has httpx + PyJWT
SECRET_KEY=dev-secret \
GOAL=https://pms-goal-XXXX.onrender.com \
EVAL=https://pms-eval-XXXX.onrender.com \
SCORE=https://pms-score-XXXX.onrender.com \
.venv/bin/python seed_demo.py
```
(`seed_demo.py` reads those env vars; ask me to finalize it if you haven't yet.)

---

## Demo-day tips

- **Warm-up:** free Render services sleep after 15 min idle (~50s first hit).
  ~1 min before the demo, open each `<url>/api/health` to wake them.
- **What's real vs sample:** Dashboard, Goals, Scorecard, Talent, Feedback are
  the real four services. People, Competencies, Development, Settings, Config
  audit come from the shim (sample data).
- **Always-on option:** switch any service to the $7 Starter plan in Render to
  remove cold starts.

## Troubleshooting

- **401 everywhere after login:** `SECRET_KEY` on Render ≠ the frontend secret.
  Keep Render `SECRET_KEY=dev-secret` and Vercel `VITE_DEV_JWT_SECRET` unset.
- **A service crashes on boot with a DB error:** confirm `DB_AUTOCREATE=0` and
  `SERVICE_DB=pms` are set (they are, in `render.yaml`).
- **CORS error in the browser console:** the services allow all origins; a CORS
  error usually means the service is still cold — retry after it wakes.
