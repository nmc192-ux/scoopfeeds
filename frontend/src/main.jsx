import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
// Side-effect import: registers the 429 response interceptor on the default
// axios module (covers pages/components using axios.get/.post directly).
// Hooks that import createApi from this same module get the per-instance
// interceptor automatically. See lib/api.js header for the full contract.
// Must precede ./App.jsx so the interceptor is in place before any request
// fires during initial render.
import "./lib/api";
import App from "./App.jsx";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,        // 5 minutes
      gcTime: 10 * 60 * 1000,           // 10 minutes
      // Don't retry 429 — the axios interceptor in lib/api.js catches
      // 429 GETs and returns cached/sentinel responses, so this path
      // normally isn't hit. Belt-and-suspenders: if a 429 ever bypasses
      // the interceptor (POST mutations, future code paths), retrying
      // would just deepen the rate-limit window. Other errors still
      // get the original 2-retry behavior.
      retry: (failureCount, err) =>
        err?.response?.status !== 429 && failureCount < 2,
      refetchOnWindowFocus: false,
      refetchInterval: 15 * 60 * 1000,  // auto-refresh every 15 min
    },
  },
});

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </BrowserRouter>
  </React.StrictMode>
);

// Register the service worker in production builds only. In dev the Vite HMR
// server handles assets; a SW would cache stale bundles across reloads.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Registration failures are non-fatal — the app runs fine without a SW.
    });
  });
}
