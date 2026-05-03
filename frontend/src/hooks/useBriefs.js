/**
 * useBriefs — React Query hooks for /api/briefs.
 * useBrief(slug) returns a single published brief.
 * useBriefs() lists published briefs.
 */
import { useQuery } from "@tanstack/react-query";
import axios from "axios";

const api = axios.create({ baseURL: "/api/briefs" });

export function useBriefs({ limit = 20 } = {}) {
  return useQuery({
    queryKey: ["briefs", limit],
    queryFn: async () => (await api.get(`/?limit=${limit}`)).data,
    staleTime: 5 * 60 * 1000,
  });
}

export function useBrief(slug) {
  return useQuery({
    queryKey: ["brief", slug],
    queryFn: async () => (await api.get(`/${slug}`)).data,
    enabled: !!slug,
    staleTime: 5 * 60 * 1000,
  });
}
