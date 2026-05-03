/**
 * useEvents — React Query hooks for /api/ri/events endpoints.
 *
 * Base: /api/ri/events  (avoids collision with /api/events SSE stream)
 */

import { useQuery } from "@tanstack/react-query";
import axios from "axios";

const api = axios.create({ baseURL: "/api/ri" });

export function useEvents({ category, status = "active", limit = 30 } = {}) {
  return useQuery({
    queryKey: ["events-list", { category, status, limit }],
    queryFn: async () => {
      const params = new URLSearchParams({ status, limit: String(limit) });
      if (category) params.set("category", category);
      const { data } = await api.get(`/events?${params}`);
      return data;
    },
    staleTime:       3 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });
}

export function useEvent(slug) {
  return useQuery({
    queryKey: ["event", slug],
    queryFn: async () => {
      const { data } = await api.get(`/events/${slug}`);
      return data;
    },
    enabled: !!slug,
    staleTime: 2 * 60 * 1000,
  });
}

export function useEventTimeline(slug, { kind, limit = 50 } = {}) {
  return useQuery({
    queryKey: ["event-timeline", slug, { kind, limit }],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: String(limit) });
      if (kind) params.set("kind", kind);
      const { data } = await api.get(`/events/${slug}/timeline?${params}`);
      return data;
    },
    enabled: !!slug,
    staleTime: 2 * 60 * 1000,
  });
}

export function useEventMarkets(slug) {
  return useQuery({
    queryKey: ["event-markets", slug],
    queryFn: async () => {
      const { data } = await api.get(`/events/${slug}/markets`);
      return data;
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
      const { data } = await api.get(`/events/${slug}/actors`);
      return data;
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
      const { data } = await api.get(`/events/${slug}/articles?${params}`);
      return data;
    },
    enabled: !!slug,
    staleTime: 3 * 60 * 1000,
  });
}

export function useEventPerspectives(slug) {
  return useQuery({
    queryKey: ["event-perspectives", slug],
    queryFn: async () => {
      const { data } = await api.get(`/events/${slug}/perspectives`);
      return data;
    },
    enabled: !!slug,
    staleTime: 5 * 60 * 1000,
  });
}
