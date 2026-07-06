// Envelope-aware clients for the four real pm-* backend services (pm-goal,
// pm-eval, pm-score, pm-notify). Each is a standalone FastAPI service with its
// own context path, returning the URF BaseRspVO { code, message, data } shape
// (and PageRspVO<T> for paginated lists, which adds pagination metadata
// alongside `data`). This module unwraps `data` and surfaces the server's
// `message` on error (e.g. "section weights must total 10").
//
// Same-origin deployment (prod, via gateway/reverse-proxy) is the default —
// each service is reachable at its own relative context path. Set the
// VITE_PM_*_URL env vars to point at a different origin (e.g. local dev
// against a remote environment).
import { TOKEN_KEY } from "./api";

// Each service's FastAPI router is actually mounted at /api/pm-* (see each
// service's app/*/router.py APIRouter(prefix=...)), not the bare /pm-* context
// path from the architecture spec — match the real backend here.
const GOAL_BASE = import.meta.env.VITE_PM_GOAL_URL || "/api/pm-goal";
const EVAL_BASE = import.meta.env.VITE_PM_EVAL_URL || "/api/pm-eval";
const SCORE_BASE = import.meta.env.VITE_PM_SCORE_URL || "/api/pm-score";
const NOTIFY_BASE = import.meta.env.VITE_PM_NOTIFY_URL || "/api/pm-notify";

interface Envelope<T> {
  code: number;
  message: string;
  data: T;
}

/** Thrown when a service responds 404 / "not found" so callers can degrade gracefully
 * (e.g. the Dashboard's "IPF not available" state) instead of treating it as a hard failure. */
export class NotFoundError extends Error {}

function makeClient(base: string) {
  async function call<T>(path: string, method: string, body?: unknown): Promise<T> {
    const token = typeof localStorage !== "undefined" ? localStorage.getItem(TOKEN_KEY) : null;
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let env: Envelope<T> | null = null;
    try {
      env = (await res.json()) as Envelope<T>;
    } catch {
      /* non-JSON body */
    }
    if (res.status === 404) {
      throw new NotFoundError(env?.message || res.statusText || "Not found");
    }
    if (!res.ok || (env && env.code !== 200)) {
      throw new Error(env?.message || res.statusText || "Request failed");
    }
    return (env as Envelope<T>).data;
  }

  return {
    get: <T>(path: string) => call<T>(path, "GET"),
    post: <T>(path: string, body?: unknown) => call<T>(path, "POST", body),
    put: <T>(path: string, body?: unknown) => call<T>(path, "PUT", body),
  };
}

/** pm-goal: performance framework, review periods, goal authoring/cascade, bilateral acceptance. */
export const pmGoal = makeClient(GOAL_BASE);
/** pm-eval: self/reviewer evaluations and continuous feedback. */
export const pmEval = makeClient(EVAL_BASE);
/** pm-score: IPF scorecards, 9-box talent placement, development plans, calibration. */
export const pmScore = makeClient(SCORE_BASE);
/** pm-notify: notifications and read state. */
export const pmNotify = makeClient(NOTIFY_BASE);

function authHeader(): Record<string, string> {
  const token = typeof localStorage !== "undefined" ? localStorage.getItem(TOKEN_KEY) : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** POST multipart/form-data (e.g. goal-sheet .xlsx import) — the generic
 * JSON-only client above can't send files. Returns the unwrapped `data`. */
export async function pmGoalUploadFile<T>(path: string, file: File): Promise<T> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${GOAL_BASE}${path}`, { method: "POST", headers: authHeader(), body: form });
  const env = (await res.json()) as Envelope<T>;
  if (!res.ok || env.code !== 200) throw new Error(env.message || "Upload failed");
  return env.data;
}

/** GET a binary file response (e.g. goal-sheet .xlsx export) — bypasses the
 * envelope-unwrapping client since the response body IS the file, not JSON. */
export async function pmGoalDownloadFile(path: string): Promise<{ blob: Blob; filename: string }> {
  const res = await fetch(`${GOAL_BASE}${path}`, { headers: authHeader() });
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const disposition = res.headers.get("Content-Disposition") || "";
  const match = /filename="?([^"]+)"?/.exec(disposition);
  return { blob: await res.blob(), filename: match?.[1] || "goals.xlsx" };
}
