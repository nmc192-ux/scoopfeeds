/**
 * useEvents — React Query hooks for /api/ri/events endpoints.
 *
 * Base: /api/ri/events  (avoids collision with /api/events SSE stream)
 */

import { useQuery } from "@tanstack/react-query";
import { createApi } from "../lib/api";

// createApi (not bare axios): these endpoints sit behind the /api/ri rate
// limiter, and the shared wrapper provides the 429 interceptor + tiered cache.
// Bare axios here was why rate-limited dossiers rendered as "Event not found"
// with no retry (2026-07-13 audit, finding P0-1).
const api = createApi({ baseURL: "/api/ri" });

// The interceptor swallows 429s: cached data when warm, null when cold. Null
// from a rate-limited response must surface as a *transient* error — callers
// use err.transient to render "temporarily busy" and React Query retries —
// never as data, which downstream reads as "event does not exist".
function unwrapOrThrow(res) {
  if (res.data == null && res._meta?.status === "rate-limited") {
    const err = new Error("rate_limited");
    err.transient = true;
    throw err;
  }
  return res.data;
}

// 404 means the resource genuinely doesn't exist — retrying is noise. Anything
// else (5xx, network, swallowed 429) gets React Query's exponential backoff.
function retryUnlessNotFound(failureCount, error) {
  if (error?.response?.status === 404) return false;
  return failureCount < 3;
}

export function useEvents({ category, status = "active", limit = 30, sort } = {}) {
  return useQuery({
    queryKey: ["events-list", { category, status, limit, sort }],
    queryFn: async () => {
      const params = new URLSearchParams({ status, limit: String(limit) });
      if (category) params.set("category", category);
      if (sort) params.set("sort", sort);
      return unwrapOrThrow(await api.get(`/events?${params}`));
    },
    staleTime:       3 * 60 * 1000,
    // 30s while failing (the homepage shows "retrying…" and must mean it);
    // normal 5-min cadence when healthy.
    refetchInterval: (query) => (query.state.status === "error" ? 30 * 1000 : 5 * 60 * 1000),
    retry: retryUnlessNotFound,
  });
}

export function useEvent(slug) {
  return useQuery({
    queryKey: ["event", slug],
    queryFn: async () => {
      return unwrapOrThrow(await api.get(`/events/${slug}`));
    },
    enabled: !!slug,
    staleTime: 2 * 60 * 1000,
    retry: retryUnlessNotFound,
    // Keep re-attempting a transiently-failed dossier so "temporarily busy —
    // retrying" is literally true; a 404 stays settled.
    refetchInterval: (query) =>
      query.state.status === "error" && query.state.error?.response?.status !== 404
        ? 30 * 1000
        : false,
  });
}

export function useEventTimeline(slug, { kind, limit = 50 } = {}) {
  return useQuery({
    queryKey: ["event-timeline", slug, { kind, limit }],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: String(limit) });
      if (kind) params.set("kind", kind);
      return unwrapOrThrow(await api.get(`/events/${slug}/timeline?${params}`));
    },
    enabled: !!slug,
    staleTime: 2 * 60 * 1000,
  });
}

// A6 event-log timeline (occurrence-deduped), dark behind ?tl=1. enabled-gated so the
// dark path issues no extra fetch; computed read-side, cached like the other reads.
export function useEventTimelineLog(slug, { enabled = true } = {}) {
  return useQuery({
    queryKey: ["event-timeline-log", slug],
    queryFn: async () => {
      return unwrapOrThrow(await api.get(`/events/${slug}/timeline-log`));
    },
    enabled: !!slug && enabled,
    staleTime: 2 * 60 * 1000,
  });
}

export function useEventMarkets(slug) {
  return useQuery({
    queryKey: ["event-markets", slug],
    queryFn: async () => {
      return unwrapOrThrow(await api.get(`/events/${slug}/markets`));
    },
    enabled:         !!slug,
    staleTime:       3 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });
}

export function useEventActors(slug) {
  return useQuery({
    queryKey: ["event-actors", slug],
    queryFn: async () => {
      return unwrapOrThrow(await api.get(`/events/${slug}/actors`));
    },
    enabled: !!slug,
    staleTime: 10 * 60 * 1000,
  });
}

export function useEventArticles(slug, { limit = 30, offset = 0 } = {}) {
  return useQuery({
    queryKey: ["event-articles", slug, { limit, offset }],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
      return unwrapOrThrow(await api.get(`/events/${slug}/articles?${params}`));
    },
    enabled: !!slug,
    staleTime: 3 * 60 * 1000,
  });
}

// Coverage grouped BY OUTLET over ALL event articles (A2 dossier). Unlike
// useEventArticles (capped at 100), the outlet count here matches the header's
// source_count exactly.
export function useEventCoverage(slug) {
  return useQuery({
    queryKey: ["event-coverage", slug],
    queryFn: async () => {
      return unwrapOrThrow(await api.get(`/events/${slug}/coverage`));
    },
    enabled: !!slug,
    staleTime: 3 * 60 * 1000,
  });
}

// Render-ready facets for the A5 "Threads in this story" shelf (dark behind
// ?facets=1 — the `enabled` flag keeps the dark path zero-cost: no fetch at all
// unless the param is present). Rows are already earn-render-qualified server-side;
// the shelf renders only when >= 2 come back.
export function useEventFacets(slug, { enabled = true } = {}) {
  return useQuery({
    queryKey: ["event-facets", slug],
    queryFn: async () => {
      return unwrapOrThrow(await api.get(`/events/${slug}/facets`));
    },
    enabled: !!slug && enabled,
    staleTime: 5 * 60 * 1000,
  });
}

export function useEventPerspectives(slug) {
  return useQuery({
    queryKey: ["event-perspectives", slug],
    queryFn: async () => {
      return unwrapOrThrow(await api.get(`/events/${slug}/perspectives`));
    },
    enabled: !!slug,
    staleTime: 5 * 60 * 1000,
  });
}

export function useEventSentiment(slug, { sinceMs, source } = {}) {
  return useQuery({
    queryKey: ["event-sentiment", slug, { sinceMs, source }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (sinceMs) params.set("sinceMs", String(sinceMs));
      if (source)  params.set("source", source);
      return unwrapOrThrow(await api.get(`/events/${slug}/sentiment?${params}`));
    },
    enabled:         !!slug,
    staleTime:       3 * 60 * 1000,
    refetchInterval: 10 * 60 * 1000,
  });
}

export function useWorldMap({ category, minSeverity = 0, limit = 300 } = {}) {
  return useQuery({
    queryKey: ["world-map", { category, minSeverity, limit }],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: String(limit), minSeverity: String(minSeverity) });
      if (category) params.set("category", category);
      return unwrapOrThrow(await api.get(`/events/world-map?${params}`));
    },
    staleTime:       2 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });
}

export function useEventRealityIndex(slug, { history = false } = {}) {
  return useQuery({
    queryKey: ["event-reality-index", slug, { history }],
    queryFn: async () => {
      return unwrapOrThrow(await api.get(`/events/${slug}/reality-index?history=${history}`));
    },
    enabled:         !!slug,
    staleTime:       3 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });
}
