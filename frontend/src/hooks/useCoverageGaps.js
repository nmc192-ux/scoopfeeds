/**
 * useCoverageGaps — React Query hooks for /api/ri/gaps (#262). Measured by region.
 *   useCoverageGapsDaily()   the last 24 h
 *   useCoverageGapsWeekly()  the latest stored weekly Gap Report, or null when none
 */
import { useQuery } from "@tanstack/react-query";
import axios from "axios";

const api = axios.create({ baseURL: "/api/ri/gaps" });

export function useCoverageGapsDaily({ enabled = true } = {}) {
  return useQuery({
    queryKey: ["coverage-gaps", "daily"],
    queryFn: async () => (await api.get("/daily")).data,
    staleTime: 5 * 60 * 1000,
    enabled,
  });
}

export function useCoverageGapsWeekly({ enabled = true } = {}) {
  return useQuery({
    queryKey: ["coverage-gaps", "weekly"],
    queryFn: async () => {
      try {
        return (await api.get("/weekly")).data;
      } catch (err) {
        if (err?.response?.status === 404) return null; // no report stored yet
        throw err;
      }
    },
    staleTime: 30 * 60 * 1000,
    retry: false,
    enabled,
  });
}
