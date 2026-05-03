/**
 * useTruthGap / useAnomalies — React Query hooks for the cross-event
 * Reality Index Phase 3 endpoints.
 */

import { useQuery } from "@tanstack/react-query";
import axios from "axios";

const api = axios.create({ baseURL: "/api/ri" });

export function useTruthGap({ direction = "both", windowMs, limit = 25 } = {}) {
  return useQuery({
    queryKey: ["truth-gap", { direction, windowMs, limit }],
    queryFn: async () => {
      const params = new URLSearchParams({ direction, limit: String(limit) });
      if (windowMs) params.set("windowMs", String(windowMs));
      const { data } = await api.get(`/truth-gap?${params}`);
      return data;
    },
    staleTime:       3 * 60 * 1000,
    refetchInterval: 10 * 60 * 1000,
  });
}

export function useAnomalies({ limit = 30, sinceMs, type, includeAck = false } = {}) {
  return useQuery({
    queryKey: ["anomalies", { limit, sinceMs, type, includeAck }],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: String(limit), includeAck: String(includeAck) });
      if (sinceMs) params.set("sinceMs", String(sinceMs));
      if (type)    params.set("type", type);
      const { data } = await api.get(`/anomalies?${params}`);
      return data;
    },
    staleTime:       60 * 1000,
    refetchInterval: 2 * 60 * 1000,
  });
}
