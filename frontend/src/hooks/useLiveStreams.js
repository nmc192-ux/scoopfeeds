import { useQuery } from "@tanstack/react-query";
import { createApi } from "../lib/api";

const api = createApi({ baseURL: "/api" });

/**
 * Fetches the current YouTube live-stream video IDs for all channels
 * from our backend, which polls YouTube's RSS feeds every 10 minutes.
 *
 * Returns: { streams: { aljazeera: "VIDEO_ID", geo: "VIDEO_ID", ... }, isLoading, isError }
 */
export function useLiveStreams() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["live-streams"],
    queryFn:  async () => {
      const { data } = await api.get("/live-stream");
      if (!data.success) throw new Error("Live stream fetch failed");
      return data.streams ?? {};
    },
    staleTime:       9 * 60 * 1000,  // consider fresh for 9 min
    refetchInterval: 10 * 60 * 1000, // re-fetch every 10 min
    retry: 2,
    placeholderData: (prev) => prev,
  });

  return { streams: data ?? {}, isLoading, isError };
}
