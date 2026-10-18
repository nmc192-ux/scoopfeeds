/**
 * useSiteConfig — runtime site flags from GET /api/site-config.
 *
 * The SPA is built once; env flags live on the server. Defaults are the SAFE
 * values (odds hidden, v2 off) so nothing flashes in while the request is in
 * flight or if it fails.
 *
 * v2 is also switchable per visit with ?v2=1 (kept in sessionStorage so it
 * survives in-app navigation).
 */

import { useQuery } from "@tanstack/react-query";
import { createApi } from "../lib/api";

const api = createApi({ baseURL: "/api" });
const DEFAULTS = { marketOdds: false, v2: false };

function v2FromUrl() {
  try {
    const q = new URLSearchParams(window.location.search).get("v2");
    if (q === "1") sessionStorage.setItem("scoop_v2", "1");
    if (q === "0") sessionStorage.removeItem("scoop_v2");
    return sessionStorage.getItem("scoop_v2") === "1";
  } catch {
    return false;
  }
}

export function useSiteConfig() {
  const { data } = useQuery({
    queryKey: ["site-config"],
    queryFn: async () => {
      const res = await api.get("/site-config");
      return res.data && typeof res.data === "object" ? res.data : DEFAULTS;
    },
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
  const cfg = { ...DEFAULTS, ...(data || {}) };
  return { marketOdds: cfg.marketOdds === true, v2: cfg.v2 === true || v2FromUrl() };
}

export function useMarketOdds() {
  return useSiteConfig().marketOdds;
}
