import { useQuery } from "@tanstack/react-query";
import { createApi } from "../lib/api";

const api = createApi({ baseURL: "/api" });

// List of all tracked live events (card index for the Live tab).
export function useLiveEvents() {
  return useQuery({
    queryKey: ["live-events"],
    queryFn: async () => {
      const { data } = await api.get("/live-events");
      return data.data || [];
    },
    staleTime: 2 * 60 * 1000,     // 2 min
    refetchInterval: 5 * 60 * 1000, // 5 min — these change slowly
  });
}

// Emerging event candidates — entities spiking in the feed that aren't
// yet tracked as seed events. Used to render an "Emerging" strip at the
// top of the Live tab.
export function useEventCandidates() {
  return useQuery({
    queryKey: ["live-event-candidates"],
    queryFn: async () => {
      const { data } = await api.get("/live-events/_/candidates");
      return data.data || [];
    },
    staleTime: 10 * 60 * 1000,
    refetchInterval: 30 * 60 * 1000,
  });
}

// Full dossier for one event (timestamped brief + live metrics).
export function useEventDossier(id) {
  return useQuery({
    queryKey: ["live-event", id],
    queryFn: async () => {
      const { data } = await api.get(`/live-events/${id}`);
      return data.data;
    },
    enabled: Boolean(id),
    staleTime: 60 * 1000,
    refetchInterval: 3 * 60 * 1000, // 3 min — crude oil tile benefits from being fresh
  });
}
