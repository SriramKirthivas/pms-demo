
import type { Plugin } from "vite";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

/**
 * Injects the canvas postMessage bridge into every dev + production index.html so the
 * parent app can install the vh-fix script cross-origin (see frontend IframeNavigation).
 * Without this, `vite build` drops the hand-written inline script from source index.html
 * in some pipelines — the transform runs for all HTML outputs.
 */
function uxpilotCanvasVhBridge(): Plugin {
  return {
    name: "uxpilot-canvas-vh-bridge",
    transformIndexHtml(html) {
      if (html.includes("__UXP_VH_FIX_BRIDGE__")) return html;
      const bridge =
        "<script>" +
        "(function(){\n" +
        "if (window.__UXP_VH_FIX_BRIDGE__) return;\n" +
        "window.__UXP_VH_FIX_BRIDGE__ = true;\n" +
        "window.addEventListener('message', function(e) {\n" +
        "var d = e.data;\n" +
        "if (!d || d.type !== 'uxpilot:install-vh-fix' || typeof d.payload !== 'string') return;\n" +
        "if (window.__uxpVhFixInjected) return;\n" +
        "window.__uxpVhFixInjected = true;\n" +
        "var s = document.createElement('script');\n" +
        "s.setAttribute('data-uxp', 'vh-fix');\n" +
        "s.textContent = d.payload;\n" +
        "(document.head || document.documentElement).appendChild(s);\n" +
        "});\n" +
        "})();" +
        "</script>";
      return html.replace(/<head([^>]*)>/i, "<head$1>\n" + bridge + "\n");
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(() => ({
  base: process.env.VITE_BASE || "/",
  plugins: [react(), uxpilotCanvasVhBridge()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
   host: true,
   // Temporary demo tunnels that expose this local dev server via a public URL:
   //  - .devtunnels.ms      = VS Code built-in Port Forwarding (no install; corporate-friendly)
   //  - .trycloudflare.com  = cloudflared quick tunnel (if ever available)
   // A stakeholder opens the tunnel URL; the SPA's /api/pm-* calls come back
   // through this same server and Vite proxies them to the local backends,
   // so forwarding ONLY port 5173 is enough for the whole app.
   allowedHosts: ['uxpilot.net','host.uxpilot.net','dev.host.uxpilot.net', 'uxpilot.ai', 'localhost', '127.0.0.1', '.trycloudflare.com', '.devtunnels.ms'],
   proxy: {
     // The four real backend services this frontend talks to directly. Each
     // FastAPI service mounts its router at /api/pm-* (see each service's
     // app/*/router.py APIRouter(prefix=...)) — these MUST be registered
     // before the generic "/api" catch-all below, since Vite's proxy matches
     // key prefixes in insertion order and "/api" would otherwise swallow
     // these more specific paths too.
     "/api/pm-goal": {
       target: process.env.VITE_PM_GOAL_PROXY || "http://localhost:8001",
       changeOrigin: true,
     },
     "/api/pm-eval": {
       target: process.env.VITE_PM_EVAL_PROXY || "http://localhost:8002",
       changeOrigin: true,
     },
     "/api/pm-score": {
       target: process.env.VITE_PM_SCORE_PROXY || "http://localhost:8003",
       changeOrigin: true,
     },
     "/api/pm-notify": {
       target: process.env.VITE_PM_NOTIFY_PROXY || "http://localhost:8004",
       changeOrigin: true,
     },
     // Forward remaining ad-hoc API calls (features with no owning pm-*
     // service, e.g. company-goals, competencies, team settings) to the
     // legacy Python backend.
     "/api": {
       target: process.env.VITE_API_PROXY || "http://localhost:8000",
       changeOrigin: true,
     },
   },
  },
}));