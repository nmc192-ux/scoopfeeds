/**
 * useWatchlists / useWatchStatus / useWatchlistActivity / useToggleWatch
 *
 * React Query bindings for /api/watchlists. All endpoints are auth-gated;
 * a 401 surfaces as `error.response.status === 401` so the UI can prompt
 * the user to sign in.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import axios from "axios";

const api = axios.create({ baseURL: "/api/watchlists" });

export function useWatchlists() {
  return useQuery({
    queryKey: ["watchlists"],
    queryFn: async () => {
      const { data } = await api.get("/");
      return data;
    },
    retry: (failures, err) => err?.response?.status !== 401 && failures < 2,
    staleTime: 60 * 1000,
  });
}

export function useWatchStatus(itemType, itemId) {
  return useQuery({
    queryKey: ["watch-status", itemType, itemId],
    queryFn: async () => {
      const { data } = await api.get(`/${itemType}/${encodeURIComponent(itemId)}/status`);
      return data;
    },
    enabled: !!itemType && !!itemId,
    retry: false,
    staleTime: 30 * 1000,
  });
}

export function useWatchlistActivity({ sinceMs, limit = 50 } = {}) {
  return useQuery({
    queryKey: ["watchlist-activity", { sinceMs, limit }],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: String(limit) });
      if (sinceMs) params.set("sinceMs", String(sinceMs));
      const { data } = await api.get(`/activity?${params}`);
      return data;
    },
    retry:           (f, e) => e?.response?.status !== 401 && f < 2,
    staleTime:       60 * 1000,
    refetchInterval: 2 * 60 * 1000,
  });
}

export function useToggleWatch(itemType, itemId, opts = {}) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ watching, ...payload }) => {
      if (watching) {
        const { data } = await api.delete(`/${itemType}/${encodeURIComponent(itemId)}`);
        return data;
      } else {
        const { data } = await api.post("/", { item_type: itemType, item_id: itemId, ...payload });
        return data;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["watch-status", itemType, itemId] });
      qc.invalidateQueries({ queryKey: ["watchlists"] });
      qc.invalidateQueries({ queryKey: ["watchlist-activity"] });
      opts.onSuccess?.();
    },
    onError: (err) => {
      opts.onError?.(err);
    },
  });
}
