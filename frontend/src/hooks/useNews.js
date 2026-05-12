import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import axios from "axios";
import { useNewsStore } from "../store/newsStore";
import { rankArticles } from "../lib/ranker";
import { useGeo } from "./useGeo";

const api = axios.create({ baseURL: "/api" });

// ─── Fetch Functions ──────────────────────────────────────────────────────

// The backend now expects a `tab` id (one of the 9 new topics). For the Local
// tab we additionally pass the user's country code so the server can resolve
// it to the right set of source regions.
async function fetchNews({ tab, country, limit = 80, offset = 0, search }) {
  const params = { limit, offset };
  if (tab && tab !== "top") params.tab = tab;
  if (tab === "local" && country) params.country = country;
  if (search) params.search = search;

  const { data } = await api.get("/news", { params });
  return data.data || [];
}

async function fetchFeatured(limit = 7) {
  const { data } = await api.get("/news/featured", { params: { limit } });
  return data.data || [];
}

async function fetchTopics() {
  const { data } = await api.get("/news/topics");
  return data.data || [];
}

async function fetchStats() {
  const { data } = await api.get("/news/stats");
  return data.data || {};
}

async function fetchHealth() {
  const { data } = await api.get("/health");
  return data;
}

async function fetchPublicConfig() {
  const { data } = await api.get("/public-config");
  return data || {};
}

// ─── Hooks ────────────────────────────────────────────────────────────────

export function useNews() {
  const { activeTopics, searchQuery, preferredTopics, preferredSources, mutedSources } = useNewsStore();
  const { countryCode } = useGeo();
  // Tabs are mutually exclusive; activeTopics is always length 1 in the new
  // model. Keep the array for saved-articles back-compat.
  const tab = activeTopics[0] || "top";

  const query = useQuery({
    // Include country in the key only for the Local tab — otherwise the tech
    // tab would needlessly refetch when the user crosses a border.
    queryKey: ["news", tab, tab === "local" ? countryCode : null, searchQuery],
    queryFn: () => fetchNews({
      tab,
      country: tab === "local" ? countryCode : null,
      search: searchQuery || null,
      limit: 80,
    }),
    staleTime: 3 * 60 * 1000,
    refetchInterval: 15 * 60 * 1000,
    placeholderData: (prev) => prev,
  });

  const ranked = useMemo(
    () => rankArticles(query.data || [], { preferredTopics, preferredSources, mutedSources }),
    [query.data, preferredTopics, preferredSources, mutedSources]
  );

  return { ...query, data: ranked };
}

export function useFeatured() {
  return useQuery({
    queryKey: ["featured"],
    queryFn: () => fetchFeatured(7),
    staleTime: 5 * 60 * 1000,
    refetchInterval: 15 * 60 * 1000,
  });
}

export function useTopics() {
  return useQuery({
    queryKey: ["topics"],
    queryFn: fetchTopics,
    staleTime: 10 * 60 * 1000,
  });
}

export function useStats() {
  return useQuery({
    queryKey: ["stats"],
    queryFn: fetchStats,
    staleTime: 60 * 1000,
    refetchInterval: 60 * 1000,
  });
}

export function useHealth() {
  return useQuery({
    queryKey: ["health"],
    queryFn: fetchHealth,
    staleTime: 30 * 1000,
    refetchInterval: 30 * 1000,
    retry: 1,
  });
}

export function usePublicConfig() {
  return useQuery({
    queryKey: ["public-config"],
    queryFn: fetchPublicConfig,
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

export function useRefresh() {
  const queryClient = useQueryClient();
  const setLastRefreshed = useNewsStore(s => s.setLastRefreshed);

  return async () => {
    try {
      await api.post("/news/refresh");
      setTimeout(() => {
        queryClient.invalidateQueries();
        setLastRefreshed(new Date().toISOString());
      }, 3000); // wait 3s for backend to start fetching
    } catch (err) {
      console.error("Refresh failed:", err);
    }
  };
}
