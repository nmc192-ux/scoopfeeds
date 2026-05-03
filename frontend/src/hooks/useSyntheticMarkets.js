/**
 * useSyntheticMarkets — React Query hooks for /api/synthetic-markets.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import axios from "axios";

const api = axios.create({ baseURL: "/api/synthetic-markets" });

export function useSyntheticMarkets({ resolved = false, limit = 30 } = {}) {
  return useQuery({
    queryKey: ["synth-markets", { resolved, limit }],
    queryFn: async () => (await api.get(`/?resolved=${resolved ? 1 : 0}&limit=${limit}`)).data,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
}

export function useSyntheticMarket(id) {
  return useQuery({
    queryKey: ["synth-market", id],
    queryFn: async () => (await api.get(`/${id}`)).data,
    enabled: !!id,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export function useLeaderboard({ limit = 50 } = {}) {
  return useQuery({
    queryKey: ["synth-leaderboard", limit],
    queryFn: async () => (await api.get(`/leaderboard?limit=${limit}`)).data,
    staleTime: 5 * 60_000,
  });
}

export function useTradeQuote(id) {
  // Mutation, not query — caller fires it on slider change.
  return useMutation({
    mutationFn: async ({ side, amount }) => (await api.post(`/${id}/quote`, { side, amount })).data,
  });
}

export function useExecuteTrade(id) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ side, amount }) => (await api.post(`/${id}/trade`, { side, amount })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["synth-market", id] });
      qc.invalidateQueries({ queryKey: ["synth-markets"] });
    },
  });
}
