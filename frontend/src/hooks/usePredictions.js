/**
 * usePredictions — React Query hooks for /api/predictions endpoints.
 * Mirrors the useAnalysis.js pattern.
 */

import { useQuery } from "@tanstack/react-query";
import axios from "axios";

const api = axios.create({ baseURL: "/api" });

/** List active markets, optionally filtered by category and min volume. */
export function usePredictions({ category, minVolume = 0, limit = 50 } = {}) {
  return useQuery({
    queryKey: ["predictions-list", { category, minVolume, limit }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (category) params.set("category", category);
      if (minVolume) params.set("minVolume", String(minVolume));
      if (limit)     params.set("limit", String(limit));
      const { data } = await api.get(`/predictions?${params}`);
      return data;
    },
    staleTime:       3 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });
}

/** Single market with confidence + latest snapshot. */
export function usePrediction(id) {
  return useQuery({
    queryKey: ["predictions-detail", id],
    queryFn: async () => {
      const { data } = await api.get(`/predictions/${encodeURIComponent(id)}`);
      return data;
    },
    enabled:   Boolean(id),
    staleTime: 2 * 60 * 1000,
  });
}

/** Time-series price history. */
export function usePredictionHistory(id, hours = 168) {
  return useQuery({
    queryKey: ["predictions-history", id, hours],
    queryFn: async () => {
      const { data } = await api.get(`/predictions/${encodeURIComponent(id)}/history?hours=${hours}`);
      return data;
    },
    enabled:   Boolean(id),
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Markets bound to the cluster(s) containing this article. The most useful
 * lookup for ReaderModal — given an open article, return its prediction
 * context. Empty array when nothing bound (UI hides the panel).
 */
export function useArticlePredictions(articleId) {
  return useQuery({
    queryKey: ["predictions-article", articleId],
    queryFn: async () => {
      const { data } = await api.get(`/predictions/article/${encodeURIComponent(articleId)}`);
      return data;
    },
    enabled:   Boolean(articleId),
    staleTime: 5 * 60 * 1000,
    retry:     1,
  });
}

/** Markets bound to a specific cluster (for use on cluster pages). */
export function useClusterPredictions(clusterId) {
  return useQuery({
    queryKey: ["predictions-cluster", clusterId],
    queryFn: async () => {
      const { data } = await api.get(`/predictions/clusters/${encodeURIComponent(clusterId)}`);
      return data;
    },
    enabled:   Boolean(clusterId),
    staleTime: 5 * 60 * 1000,
  });
}

/** Top movers for the dashboard. */
export function usePredictionMovers({ windowHours = 24, limit = 20 } = {}) {
  return useQuery({
    queryKey: ["predictions-movers", windowHours, limit],
    queryFn: async () => {
      const { data } = await api.get(`/predictions/movers?windowHours=${windowHours}&limit=${limit}`);
      return data;
    },
    staleTime:       5 * 60 * 1000,
    refetchInterval: 10 * 60 * 1000,
  });
}

/**
 * Bulk RI badges for a set of article IDs (Phase 4i). Used by the home
 * NewsGrid to surface ProbabilityBar / TruthGapBadge / AnomalyChip on
 * cards bound to tracked events. One round-trip per render of the grid;
 * cached 60s.
 *
 * Returns `{ badges: { [id]: badge|null } }` shaped to make the per-card
 * lookup a single property access.
 */
export function useArticleBadges(articleIds = []) {
  // Stable key from sorted ids so two equivalent lists hit the same cache.
  const ids = (articleIds || []).filter(Boolean);
  const key = ids.length ? [...ids].sort().join(",") : "";
  return useQuery({
    queryKey: ["predictions-badges", key],
    queryFn: async () => {
      if (!ids.length) return { badges: {} };
      const { data } = await api.get(`/predictions/badges?ids=${encodeURIComponent(ids.join(","))}`);
      return data;
    },
    enabled:    ids.length > 0,
    staleTime:  60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });
}
