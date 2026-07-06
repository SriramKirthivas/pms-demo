// Thin fetch wrapper for the Python (FastAPI) backend.
// All requests go through the Vite proxy at /api -> the load balancer -> server.

export const TOKEN_KEY = "pms_token";
// Local/Docker: "/api" (Vite proxy). Production (Vercel): set VITE_API_URL to the
// Render backend origin + "/api" (e.g. https://freya-api.onrender.com/api).
const BASE = import.meta.env.VITE_API_URL || "/api";

// Auth: the backend enforces permissions from a verified JWT. We attach the
// token from localStorage at request time (avoids React render/effect ordering).
function authHeaders(): Record<string, string> {
  const token = typeof localStorage !== "undefined" ? localStorage.getItem(TOKEN_KEY) : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
      ...(options?.headers ?? {}),
    },
  });
  if (!res.ok) {
    // Token missing/expired -> drop it and bounce to login (except during login).
    if (res.status === 401 && typeof window !== "undefined") {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem("pms_role");
      if (!window.location.pathname.endsWith("/login")) {
        window.location.href = "/login";
      }
    }
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail || detail;
    } catch {
      // non-JSON error body — keep statusText
    }
    throw new Error(detail);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PUT", body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  del: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: "DELETE",
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
};
