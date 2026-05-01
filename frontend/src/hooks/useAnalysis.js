/**
 * useAnalysis — React Query hooks for all /api/analysis endpoints.
 * Pattern mirrors useLiveEvents.js exactly.
 */
import { useQuery } from "@tanstack/react-query";
import axios from "axios";

const api = axios.create({ baseURL: "/api" });

/** Top 8 story clusters (auto-detected trending stories). */
export function useStoryClusters() {
  return useQuery({
    queryKey: ["analysis-stories"],
    queryFn: async () => {
      const { data } = await api.get("/analysis/stories");
      return data.data || [];
    },
    staleTime:       5 * 60 * 1000,
    refetchInterval: 10 * 60 * 1000,
  });
}

/** Full dossier for a single story cluster. */
export function useStoryCluster(id) {
  return useQuery({
    queryKey: ["analysis-story", id],
    queryFn: async () => {
      const { data } = await api.get(`/analysis/stories/${id}`);
      return data.data;
    },
    enabled:   Boolean(id),
    staleTime: 5 * 60 * 1000,
  });
}

/** Topic coverage counts bucketed into 3h windows for the last N hours. */
export function useTopicTrends(windowHours = 72) {
  return useQuery({
    queryKey: ["analysis-trends", windowHours],
    queryFn: async () => {
      const { data } = await api.get(`/analysis/trends?windowHours=${windowHours}`);
      return data.data || [];
    },
    staleTime:       10 * 60 * 1000,
    refetchInterval: 30 * 60 * 1000,
  });
}

/**
 * On-demand article deep dive: takeaways, tone, related IDs.
 * Pass null articleId to defer the fetch (used for lazy loading in
 * ArticleDeepDive — only fires when the panel is opened).
 */
export function useArticleDeepDive(articleId) {
  return useQuery({
    queryKey: ["analysis-article", articleId],
    queryFn: async () => {
      const { data } = await api.get(`/analysis/article/${encodeURIComponent(articleId)}`);
      return data.data;
    },
    enabled:   Boolean(articleId),
    staleTime: 6 * 60 * 60 * 1000, // matches 6h DB TTL
    retry:     1,
  });
}

/** List of explained pieces (id, slug, title, category, summary, image_url). */
export function useExplainedList() {
  return useQuery({
    queryKey: ["analysis-explained"],
    queryFn: async () => {
      const { data } = await api.get("/analysis/explained");
      return data.data || [];
    },
    staleTime:       5 * 60 * 1000,
    refetchInterval: 15 * 60 * 1000,
  });
}

/** Full explained piece by slug (includes content HTML, facts, timeline). */
export function useExplainedPiece(slug) {
  return useQuery({
    queryKey: ["analysis-explained-slug", slug],
    queryFn: async () => {
      const { data } = await api.get(`/analysis/explained/${slug}`);
      return data.data;
    },
    enabled:   Boolean(slug),
    staleTime: 10 * 60 * 1000,
  });
}
