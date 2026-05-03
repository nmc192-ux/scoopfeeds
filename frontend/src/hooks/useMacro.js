import { useQuery } from "@tanstack/react-query";
import axios from "axios";

const api = axios.create({ baseURL: "/api/macro" });

export function useMacroIndicators({ provider } = {}) {
  return useQuery({
    queryKey: ["macro", provider || "all"],
    queryFn: async () => {
      const qs = provider ? `?provider=${encodeURIComponent(provider)}` : "";
      return (await api.get(`/indicators${qs}`)).data;
    },
    staleTime: 30 * 60 * 1000,
    refetchInterval: 60 * 60 * 1000,
  });
}
