import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3001,
    host: "0.0.0.0",
    proxy: {
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
      },
      "/scoop-ops": {
        target: "http://localhost:4000",
        changeOrigin: true,
        // SPA routes under /scoop-ops/ (e.g. /scoop-ops/metrics,
        // /scoop-ops/reality-index) and API endpoints (e.g.
        // /scoop-ops/metrics-ops, /scoop-ops/ri-ops/dashboard) share
        // the same URL prefix. Browser navigations arrive with
        // Accept: text/html — those need vite's dev SPA fallback.
        // fetch() calls from React arrive with Accept: application/json
        // (or */*) — those need to be proxied to the backend.
        bypass: (req) => {
          const accept = String(req.headers?.accept || "");
          if (accept.includes("text/html")) {
            return "/index.html"; // let vite serve dev SPA shell
          }
          // undefined → proxy to backend
        },
      },
    },
  },
});
