import { useQuery } from "@tanstack/react-query";
import { createApi } from "../lib/api";

const api = createApi({ baseURL: "/api" });

/**
 * Fetches live market data: FX rates (PKR), stock indices, gold & silver.
 * Backend caches for 15 min; React Query keeps it fresh in the browser.
 */
export function useMarket() {
  return useQuery({
    queryKey: ["market"],
    queryFn: async () => {
      const { data } = await api.get("/market");
      return data.data || null;
    },
    staleTime:       15 * 60 * 1000, // don't refetch if data is <15 min old
    refetchInterval: 15 * 60 * 1000, // auto-refresh every 15 min
    retry: 1,
    placeholderData: (prev) => prev,
  });
}

/**
 * Fetches articles from a single named publication.
 * Uses the /api/news?source=... endpoint added in this session.
 */
export function usePublicationArticles(sourceName, limit = 20) {
  return useQuery({
    queryKey: ["publication-articles", sourceName],
    queryFn: async () => {
      const { data } = await api.get("/news", {
        params: { source: sourceName, limit, category: "publications" },
      });
      return data.data || [];
    },
    staleTime: 10 * 60 * 1000,
    enabled: !!sourceName,
    placeholderData: (prev) => prev,
  });
}

/**
 * Fetches articles from a single cars source.
 * Mirrors usePublicationArticles but targets category: "cars".
 */
export function useCarSourceArticles(sourceName, limit = 20) {
  return useQuery({
    queryKey: ["car-articles", sourceName],
    queryFn: async () => {
      const { data } = await api.get("/news", {
        params: { source: sourceName, limit, category: "cars" },
      });
      return data.data || [];
    },
    staleTime: 10 * 60 * 1000,
    enabled: !!sourceName,
    placeholderData: (prev) => prev,
  });
}
