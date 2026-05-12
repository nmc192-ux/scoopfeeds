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

// Module-level cache of the last successful /api/health response. Used by
// fetchHealth when the global API rate limiter (apiGlobalLimiter, 500
// req/15min/IP at backend/server.js:188) returns 429: instead of throwing
// — which would make react-query flag isError and trigger BackendOffline
// in App.jsx — we return the cached body so the UI keeps the previously-
// known state. Production is healthy; we just paused polling.
//
// Cold-start + 429 (rate-limited on the very first health poll) degrades
// gracefully: returns a minimal {status:"rate-limited"} sentinel so isError
// stays false, but Header's emerald dot, article count, and Live badge
// don't render (no fields to read). This is the deliberate trade-off —
// full-page BackendOffline is much worse than a plain Header. Persisting
// _lastHealth across page loads via sessionStorage is future scope, not
// done today.
let _lastHealth = null;

async function fetchHealth() {
  try {
    const { data } = await api.get("/health");
    _lastHealth = data;
    return data;
  } catch (err) {
    // 429 = rate-limited, not a real outage. Return cached or sentinel
    // so isError stays false. Real errors (5xx, network, CORS) re-throw.
    if (err?.response?.status === 429) {
      return _lastHealth ?? { status: "rate-limited", ratelimited: true };
    }
    throw err;
  }
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
    // Don't retry 429s — fetchHealth already catches them and returns
    // cached/sentinel data, so this path normally isn't hit. Belt-and-
    // suspenders: if a 429 ever bypasses the catch (e.g., axios behavior
    // change), retrying just deepens the rate-limit window.
    retry: (failureCount, err) =>
      err?.response?.status !== 429 && failureCount < 1,
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
