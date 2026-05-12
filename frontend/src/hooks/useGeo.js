import { useQuery } from "@tanstack/react-query";
import { createApi } from "../lib/api";
import { useEffect, useState } from "react";

const api = createApi({ baseURL: "/api" });
const OVERRIDE_KEY = "scoop.geo.override";

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
  const [override, setOverrideState] = useState(() => {
    if (typeof window === "undefined") return null;
    try {
      const raw = window.localStorage.getItem(OVERRIDE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  });

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

  const setOverride = (geo) => {
    setOverrideState(geo);
    try {
      if (geo) window.localStorage.setItem(OVERRIDE_KEY, JSON.stringify(geo));
      else     window.localStorage.removeItem(OVERRIDE_KEY);
    } catch {}
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
