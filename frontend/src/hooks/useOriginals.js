/**
 * useOriginals — React Query hook for /api/originals (#260).
 * Returns { analysis, explained, stories }; each list may be empty.
 */
import { useQuery } from "@tanstack/react-query";
import axios from "axios";

const api = axios.create({ baseURL: "/api/originals" });

export function useOriginals() {
  return useQuery({
    queryKey: ["originals"],
    queryFn: async () => (await api.get("/")).data,
    staleTime: 2 * 60 * 1000,
  });
}
