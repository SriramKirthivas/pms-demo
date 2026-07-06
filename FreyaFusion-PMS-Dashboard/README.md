# FreyaFusion-PMS-Dashboard (Frontend)

The React + TypeScript frontend for the Freya Fusion PMS module — Dashboard,
Talent Matrix, Scorecard, Goals & Cascade (+ lifecycle), Feedback, Competencies,
Settings, and the notification bell.

- **Stack:** React 18 + Vite + TypeScript + Tailwind + shadcn/ui.
- **Talks to** the backend services (Goal / Eval / Score / Notify) via the API
  gateway/ALB. Set `VITE_API_URL` to that origin + `/api`.

## Run locally (dev)
```bash
npm install
# point at the gateway (or leave unset to use the Vite proxy /api)
VITE_API_URL=http://localhost:8000/api npm run dev
```

## Build & serve (prod, nginx)
```bash
docker build --build-arg VITE_API_URL=https://<gateway-or-alb>/api -t freyafusion-pms-dashboard .
docker run -p 8080:80 freyafusion-pms-dashboard
```
