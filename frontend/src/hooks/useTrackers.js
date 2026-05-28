/**
 * useTrackers — React Query hooks for /api/ri/trackers endpoints (Sprint 1.5.2).
 *
 * Mirrors useEvents.js exactly: same axios baseURL "/api/ri", same useQuery
 * shape, same staleTime / refetchInterval cadence. Wraps the Sprint 1.5.1
 * read API:
 *   GET /api/ri/trackers?type=&status=&limit=  → list
 *   GET /api/ri/trackers/:id                    → single + revisions (Layer 2)
 *   GET /api/ri/events/:slug/trackers           → all trackers for an event
 */

import { useQuery } from "@tanstack/react-query";
import axios from "axios";

const api = axios.create({ baseURL: "/api/ri" });

export function useTrackers({ type, status = "active", limit = 30 } = {}) {
  return useQuery({
    queryKey: ["trackers-list", { type, status, limit }],
    queryFn: async () => {
      const params = new URLSearchParams({ status, limit: String(limit) });
      if (type) params.set("type", type);
      const { data } = await api.get(`/trackers?${params}`);
      return data;
    },
    staleTime:       3 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });
}

export function useTracker(id) {
  return useQuery({
    queryKey: ["tracker", id],
    queryFn: async () => {
      const { data } = await api.get(`/trackers/${id}`);
      return data;
    },
    enabled: !!id,
    staleTime: 2 * 60 * 1000,
  });
}

export function useEventTrackers(slug) {
  return useQuery({
    queryKey: ["event-trackers", slug],
    queryFn: async () => {
      const { data } = await api.get(`/events/${slug}/trackers`);
      return data;
    },
    enabled: !!slug,
    staleTime:       2 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });
}
