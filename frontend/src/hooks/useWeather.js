import { useQuery } from "@tanstack/react-query";
import { createApi } from "../lib/api";

const api = createApi({ baseURL: "/api" });

/**
 * Fetches current weather from the backend proxy (/api/weather).
 *
 * @param {Object|null} coords  — { lat, lon } or null (backend falls back to Karachi)
 */
export function useWeather(coords) {
  return useQuery({
    queryKey: ["weather", coords?.lat ?? null, coords?.lon ?? null],
    queryFn: async () => {
      const params = coords ? { lat: coords.lat, lon: coords.lon } : {};
      const { data } = await api.get("/weather", { params });
      if (!data.success) throw new Error(data.error || "Weather fetch failed");
      return data.data ?? null;
    },
    staleTime:            15 * 60 * 1000,
    refetchInterval:      15 * 60 * 1000,
    retry:                3,
    retryDelay:           (attempt) => Math.min(1000 * (attempt + 1), 5000),
    refetchOnWindowFocus: true,
    placeholderData:      (prev) => prev,
  });
}
