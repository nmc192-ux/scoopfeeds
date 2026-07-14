/**
 * useTruthGap / useAnomalies — React Query hooks for the cross-event
 * Reality Index Phase 3 endpoints.
 */

import { useQuery } from "@tanstack/react-query";
import { createApi } from "../lib/api";

const api = createApi({ baseURL: "/api/ri" });

// Callers pass sinceMs derived from Date.now(); raw values change every render,
// and a changing value inside queryKey means every render starts a new fetch —
// an unbounded loop paced only by network latency (the 2026-07-13 audit measured
// ~2.4 req/s, enough to burn the 240/15min IP budget in ~100s). Bucketing to
// 10 minutes keeps the key stable between legitimate refreshes.
const SINCE_BUCKET_MS = 10 * 60 * 1000;
function quantizeMs(ms) {
  return ms ? Math.floor(ms / SINCE_BUCKET_MS) * SINCE_BUCKET_MS : ms;
}

// The lib/api interceptor swallows 429s, resolving with cached data or null.
// A null body on a rate-limited response is not data — rethrow it as a
// transient error so React Query retries/backs off instead of rendering empty.
function unwrapOrThrow(res) {
  if (res.data == null && res._meta?.status === "rate-limited") {
    const err = new Error("rate_limited");
    err.transient = true;
    throw err;
  }
  return res.data;
}

// Normal cadence while healthy; exponential backoff (doubling, capped at 30
// minutes) while the endpoint is failing. Combined with the default
// refetchIntervalInBackground=false (made explicit below), a hidden tab
// stops polling entirely.
function backoffInterval(baseMs) {
  return (query) =>
    query.state.fetchFailureCount > 0
      ? Math.min(baseMs * 2 ** query.state.fetchFailureCount, 30 * 60 * 1000)
      : baseMs;
}

export function useTruthGap({ direction = "both", windowMs, limit = 25 } = {}) {
  return useQuery({
    queryKey: ["truth-gap", { direction, windowMs, limit }],
    queryFn: async () => {
      const params = new URLSearchParams({ direction, limit: String(limit) });
      if (windowMs) params.set("windowMs", String(windowMs));
      return unwrapOrThrow(await api.get(`/truth-gap?${params}`));
    },
    staleTime:       3 * 60 * 1000,
    refetchInterval: backoffInterval(10 * 60 * 1000),
    refetchIntervalInBackground: false,
  });
}

export function useAnomalies({ limit = 30, sinceMs, type, includeAck = false } = {}) {
  const since = quantizeMs(sinceMs);
  return useQuery({
    queryKey: ["anomalies", { limit, sinceMs: since, type, includeAck }],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: String(limit), includeAck: String(includeAck) });
      if (since) params.set("sinceMs", String(since));
      if (type)  params.set("type", type);
      return unwrapOrThrow(await api.get(`/anomalies?${params}`));
    },
    staleTime:       60 * 1000,
    refetchInterval: backoffInterval(2 * 60 * 1000),
    refetchIntervalInBackground: false,
  });
}
