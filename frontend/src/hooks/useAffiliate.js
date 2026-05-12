import { useQuery } from "@tanstack/react-query";
import { createApi } from "../lib/api";

const api = createApi({ baseURL: "/api" });

/**
 * useAffiliatePick — fetch the one affiliate program we want to surface
 * on this request, given a soft category hint.
 *
 * Backend uses the reader's country (cf-ipcountry / accept-language) to
 * select. Returns null when no program is configured for this country —
 * the widget collapses in that case.
 */
export function useAffiliatePick(category = "default") {
  const { data, isLoading } = useQuery({
    queryKey: ["affiliate-pick", category],
    queryFn: async () => {
      const { data } = await api.get("/affiliate/pick", { params: { category } });
      return data || null;
    },
    staleTime: 5 * 60 * 1000,
    gcTime:    30 * 60 * 1000,
    retry: 1,
    refetchOnWindowFocus: false,
  });

  return {
    program: data?.data || null,
    meta: data?.meta || null,
    isLoading,
  };
}

/**
 * usePaywallAffiliate — given an outlet name (e.g. "The New York Times"),
 * return an affiliate URL for a "Subscribe via Scoop" CTA. Null if we don't
 * have a program for that outlet.
 */
export function usePaywallAffiliate(sourceName) {
  const { data } = useQuery({
    enabled: !!sourceName,
    queryKey: ["affiliate-paywall", sourceName],
    queryFn: async () => {
      const { data } = await api.get("/affiliate/paywall", { params: { source: sourceName } });
      return data?.data || null;
    },
    staleTime: 10 * 60 * 1000,
    gcTime:    60 * 60 * 1000,
    retry: 0,
    refetchOnWindowFocus: false,
  });
  return data || null;
}
