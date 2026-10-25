import { useQuery } from "@tanstack/react-query";
import { createApi } from "../lib/api";
import { useEffect, useState } from "react";

const api = createApi({ baseURL: "/api" });
const OVERRIDE_KEY = "scoop.geo.override";
const GEO_EVENT = "scoop:geo-override";

function readOverride() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(OVERRIDE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

/**
 * useGeo — lightweight client-side geolocation for personalization.
 *
 * Resolution:
 *   1. User's explicit override (localStorage) — always wins
 *   2. Backend /api/geo (IP-based, 6h cached)
 *   3. Safe default (US / USD)
 *
 * Returns:
 *   {
 *     countryCode, country, currency, city, timezone,
 *     isLoading, isOverridden,
 *     setOverride(countryCode),  // "US", "PK", null to clear
 *   }
 */
export function useGeo() {
  const [override, setOverrideState] = useState(readOverride);

  const { data: detected, isLoading } = useQuery({
    queryKey: ["geo"],
    queryFn: async () => {
      const { data } = await api.get("/geo");
      return data?.data || null;
    },
    staleTime: 6 * 60 * 60 * 1000,
    gcTime:    6 * 60 * 60 * 1000,
    retry: 1,
    refetchOnWindowFocus: false,
  });

  // Every useGeo() caller keeps its own copy of the override, so a change made in
  // one component (the v2 header's country control, #190) is broadcast to the rest:
  // GEO_EVENT within this tab, the "storage" event across tabs.
  useEffect(() => {
    const sync = (e) => {
      if (e.type === "storage" && e.key !== OVERRIDE_KEY) return;
      setOverrideState(e.type === "storage" ? readOverride() : (e.detail ?? null));
    };
    window.addEventListener(GEO_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(GEO_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const setOverride = (geo) => {
    setOverrideState(geo);
    try {
      if (geo) window.localStorage.setItem(OVERRIDE_KEY, JSON.stringify(geo));
      else     window.localStorage.removeItem(OVERRIDE_KEY);
    } catch {}
    try { window.dispatchEvent(new CustomEvent(GEO_EVENT, { detail: geo || null })); } catch {}
  };

  const resolved = override || detected || {
    countryCode: "US", country: "United States",
    currency: "USD", timezone: "UTC", city: null,
  };

  return {
    ...resolved,
    isLoading: !override && isLoading,
    isOverridden: !!override,
    setOverride,
  };
}
