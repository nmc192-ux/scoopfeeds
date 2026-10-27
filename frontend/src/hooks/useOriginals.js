/**
 * useOriginals — React Query hook for /api/originals (#260).
 * Returns { analysis, explained, stories, quiz }; each list may be empty, quiz may be null.
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

/**
 * useOriginalsQuiz — /api/originals/quiz (#271). A 404 (no quiz this week) is
 * not an error: data is null and nothing is retried.
 */
export function useOriginalsQuiz() {
  return useQuery({
    queryKey: ["originals", "quiz"],
    queryFn: async () => {
      try {
        return (await api.get("/quiz")).data;
      } catch (err) {
        if (err?.response?.status === 404) return null;
        throw err;
      }
    },
    staleTime: 5 * 60 * 1000,
  });
}
