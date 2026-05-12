import { useQuery } from "@tanstack/react-query";
import { createApi } from "../lib/api";
import { useNewsStore } from "../store/newsStore";

const api = createApi({ baseURL: "/api" });

export function useVideos() {
  const { activeTopics } = useNewsStore();
  const category = activeTopics.includes("top") ? null : activeTopics[0];

  return useQuery({
    queryKey: ["videos", activeTopics],
    queryFn: async () => {
      const params = { limit: 24 };
      if (category) params.category = category;
      const { data } = await api.get("/videos", { params });
      return data.data || [];
    },
    staleTime: 10 * 60 * 1000,
    refetchInterval: 60 * 60 * 1000,
    placeholderData: (prev) => prev,
  });
}

// Fetch all videos regardless of active topic (for channel browser + Shorts)
export function useAllVideos(limit = 60) {
  return useQuery({
    queryKey: ["videos-all", limit],
    queryFn: async () => {
      const { data } = await api.get("/videos", { params: { limit } });
      return data.data || [];
    },
    staleTime: 10 * 60 * 1000,
    refetchInterval: 60 * 60 * 1000,
    placeholderData: (prev) => prev,
  });
}

export function useVideosByCategories(categories, limit = 12) {
  return useQuery({
    queryKey: ["videos-by-cats", categories, limit],
    queryFn: async () => {
      const { data } = await api.get("/videos/by-categories", {
        params: { categories: categories.join(","), limit },
      });
      return data.data || [];
    },
    staleTime: 10 * 60 * 1000,
    enabled: !!categories?.length,
  });
}
